import { ShaderMaterial, Vector3, Vector4 } from 'three';

/**
 * Stand-in for a real `sampleElevation()`/`height(dir)`. Texture-backed
 * heightmaps are a separate concern (see clipmap-constants.ts doc comment) —
 * this module is only about the LOD/morph mechanism, so an analytic function
 * keeps the fixture boundless and avoids atlas/streaming complexity entirely.
 * Extend or replace this GLSL block to plug in real terrain sampling.
 */
const TERRAIN_HEIGHT_GLSL = `
  uniform float uTerrainKind; // 0 = wave (original), 1 = noise (fbm)
  uniform bool uUseHeightMap;
  uniform sampler2D uHeightMap;
  uniform vec4 uHeightMapBounds; // minX, minZ, maxX, maxZ
  uniform float uHeightMapMinM;
  uniform float uHeightMapRangeM;
  uniform bool uUseColorMap;
  uniform sampler2D uColorMap;

  float terrainHeightWave(vec2 xz) {
    float continental = sin(xz.x / 340.0) * 6.0 + cos(xz.y / 260.0) * 5.0;
    float ridges = abs(sin(xz.x / 55.0 + xz.y / 70.0)) * 14.0;
    return continental + ridges;
  }

  float terrainHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float terrainValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = terrainHash(i);
    float b = terrainHash(i + vec2(1.0, 0.0));
    float c = terrainHash(i + vec2(0.0, 1.0));
    float d = terrainHash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float terrainFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * terrainValueNoise(p * frequency);
      frequency *= 2.02;
      amplitude *= 0.5;
    }
    return value;
  }

  float terrainHeightNoise(vec2 xz) {
    float continental = terrainFbm(xz / 400.0) * 26.0 - 13.0;
    float ridgeNoise = terrainFbm(xz / 90.0 + vec2(31.7, -14.2));
    float ridges = pow(1.0 - abs(ridgeNoise * 2.0 - 1.0), 2.0) * 18.0;
    return continental + ridges;
  }

  float terrainHeight(vec2 xz) {
    vec2 mapSize = uHeightMapBounds.zw - uHeightMapBounds.xy;
    vec2 mapUv = (xz - uHeightMapBounds.xy) / mapSize;
    if (uUseHeightMap) {
      // A bounded real source owns the map. Do not leak the analytic spike
      // terrain outside its bounds; the clipmap can cover a larger area than
      // a first-pass bake. Keep the exterior at the shared sea datum until a
      // streamed/larger source is available.
      if (all(greaterThanEqual(mapUv, vec2(0.0))) && all(lessThanEqual(mapUv, vec2(1.0)))) {
        return uHeightMapMinM + texture2D(uHeightMap, mapUv).r * uHeightMapRangeM;
      }
      return 0.0;
    }
    return uTerrainKind < 0.5 ? terrainHeightWave(xz) : terrainHeightNoise(xz);
  }
`;

/**
 * The core mechanism under test. Every vertex, from every tile at every
 * discrete instancing level, computes its own fractional LOD purely from its
 * own world-space position and the camera position, then lerps between its
 * own LOD's sampled height and the next-coarser LOD's sampled height by that
 * fraction. Because it is a pure function of world position, two neighbouring
 * tiles evaluated at a shared boundary vertex compute IDENTICAL results
 * regardless of which tile "owns" that vertex or which discrete level each
 * tile is instanced at — this is what makes *that* case crack-free.
 *
 * It does not by itself close the T-junction gap where a finer tile's edge
 * has vertices with no counterpart on a coarser neighbour: this continuousLevel
 * blend follows a circular (distance-based) isoline, while the clipmap ring
 * boundary (clipmap-layout.ts) is a square tile-block edge — the two diverge
 * most at the block's corners, which is where the T-junction crack showed up.
 * The second blend below (`borderBlend`) fixes that directly: near the outer
 * edge of a tile's own clipmap ring, force its vertices onto the *next-coarser*
 * grid (this tile's own level + 1), so both sides of the ring boundary
 * converge on the identical coarse vertex positions instead of the finer side
 * sampling the true nonlinear height field while the coarser side only
 * linearly interpolates between its own sparser vertices.
 */
const VERTEX_SHADER_BODY = `
  uniform vec3 uCameraWorldPos;
  uniform float uBaseTileSizeM;
  uniform float uGridResolution;
  uniform float uMaxLevel;
  uniform float uFinestSwitchDistanceM;
  uniform float uHeightScale;
  uniform float uBlockRadiusTiles;
  uniform bool uMorphEnabled;

  attribute vec3 instanceOffset;
  attribute float instanceScale;

  varying float vContinuousLevel;
  varying vec3 vWorldPos;

  vec2 snapToGrid(vec2 p, float cell) {
    return floor(p / cell + 0.5) * cell;
  }

  // A level's real rendered vertex spacing: clipmap-grid-geometry.ts strides
  // its shared index buffer by 2^level, but clamps that stride at
  // uGridResolution (levels whose stride would exceed it just reuse the
  // coarsest 1-quad-per-tile geometry — see that file's per-level loop).
  // Below the clamp this compounds with the tile-size doubling into 4^level;
  // at/above it, the tile is one quad, so spacing is simply its own tile
  // size (2^level), not 4^level. Must mirror that clamp exactly, or this
  // (and borderCoarseCell below, which assumes it) overshoots the real
  // neighbour spacing at high levels by whatever factor got clamped away —
  // collapsing far vertices onto a handful of shared coarse grid points
  // instead of their true positions.
  float realVertexSpacingM(float level) {
    float clampedStride = min(pow(2.0, level), uGridResolution);
    return (clampedStride / uGridResolution) * uBaseTileSizeM * pow(2.0, level);
  }

  void main() {
    vec2 localXZ = position.xz;
    vec2 seedWorldXZ = instanceOffset.xz + localXZ * instanceScale;

    float dist = distance(uCameraWorldPos.xz, seedWorldXZ);
    float continuousLevel = clamp(
      log2(max(dist, 1.0) / uFinestSwitchDistanceM),
      0.0,
      uMaxLevel
    );
    float levelFloor = floor(continuousLevel);
    float morphAlpha = uMorphEnabled ? (continuousLevel - levelFloor) : 0.0;

    // Keyed off continuousLevel (a pure function of world position and the
    // camera), NEVER off this tile's own instanced level. That is the whole
    // load-bearing invariant: two tiles instanced at different levels, both
    // owning a copy of the same shared boundary vertex, must compute the
    // identical result for it. Keying any of this off myLevel instead makes
    // those two copies disagree and opens a gap between the tiles.
    float vertexSpacingM = uBaseTileSizeM / uGridResolution;
    float fineCell = vertexSpacingM * pow(2.0, levelFloor);
    float coarseCell = vertexSpacingM * pow(2.0, levelFloor + 1.0);
    vec2 fineXZ = snapToGrid(seedWorldXZ, fineCell);
    vec2 coarseXZ = snapToGrid(seedWorldXZ, coarseCell);

    float heightFine = terrainHeight(fineXZ) * uHeightScale;
    float heightCoarse = terrainHeight(coarseXZ) * uHeightScale;

    vec2 morphedXZ = mix(fineXZ, coarseXZ, morphAlpha);
    float morphedHeight = mix(heightFine, heightCoarse, morphAlpha);

    // Border clamp: this tile's own instanced level (recovered from
    // instanceScale, which buildClipmapTiles sets to uBaseTileSizeM * 2^level)
    // and the exact same box math buildClipmapTiles used to place it, so the
    // "am I near my ring's outer edge" test matches the CPU layout precisely
    // rather than approximating it with distance-to-camera. This is the one
    // place myLevel may be used: it targets the coarse neighbour's real
    // vertex positions, which is what closes the T-junction.
    float myLevel = floor(log2(instanceScale / uBaseTileSizeM) + 0.5);
    if (myLevel < uMaxLevel - 0.5) {
      float tileSizeAtMyLevel = uBaseTileSizeM * pow(2.0, myLevel);
      vec2 centerTileAtMyLevel = floor(uCameraWorldPos.xz / tileSizeAtMyLevel);
      vec2 boxMin = (centerTileAtMyLevel - uBlockRadiusTiles) * tileSizeAtMyLevel;
      vec2 boxMax = (centerTileAtMyLevel + uBlockRadiusTiles) * tileSizeAtMyLevel;
      vec2 distToEdge = min(seedWorldXZ - boxMin, boxMax - seedWorldXZ);
      float nearestEdgeDist = min(distToEdge.x, distToEdge.y);

      float borderCoarseCell = realVertexSpacingM(myLevel + 1.0);
      float borderBlend = uMorphEnabled
        ? (1.0 - clamp(nearestEdgeDist / borderCoarseCell, 0.0, 1.0))
        : 0.0;

      if (borderBlend > 0.0) {
        vec2 borderCoarseXZ = snapToGrid(seedWorldXZ, borderCoarseCell);
        float borderCoarseHeight = terrainHeight(borderCoarseXZ) * uHeightScale;
        morphedXZ = mix(morphedXZ, borderCoarseXZ, borderBlend);
        morphedHeight = mix(morphedHeight, borderCoarseHeight, borderBlend);
      }
    }

    vWorldPos = vec3(morphedXZ.x, morphedHeight, morphedXZ.y);
    vContinuousLevel = continuousLevel;

    vec4 mvPosition = modelViewMatrix * vec4(vWorldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER_BODY = `
  uniform bool uShowLevelTint;
  uniform float uMaxLevel;
  varying float vContinuousLevel;
  varying vec3 vWorldPos;

  vec3 levelTint(float level) {
    vec3 colors[4];
    colors[0] = vec3(0.36, 0.78, 0.42);
    colors[1] = vec3(0.32, 0.62, 0.86);
    colors[2] = vec3(0.92, 0.75, 0.28);
    colors[3] = vec3(0.86, 0.34, 0.34);
    // Spread the 4-color gradient across the whole 0..uMaxLevel range rather
    // than clamping at level 3: with LEVEL_COUNT=4 (uMaxLevel=3) this is
    // exactly the old per-level mapping (t == level), but it keeps far
    // levels visually distinguishable instead of all reading as pure red
    // once a scene configures more than 4 levels (see clipmap-far-coverage-
    // spike, which needs to judge detail across 12).
    float t = clamp(level / max(uMaxLevel, 1.0) * 3.0, 0.0, 3.0);
    int i0 = int(floor(t));
    int i1 = min(i0 + 1, 3);
    return mix(colors[i0], colors[i1], fract(t));
  }

  void main() {
    float eps = 0.5;
    float hL = terrainHeight(vWorldPos.xz + vec2(-eps, 0.0));
    float hR = terrainHeight(vWorldPos.xz + vec2(eps, 0.0));
    float hD = terrainHeight(vWorldPos.xz + vec2(0.0, -eps));
    float hU = terrainHeight(vWorldPos.xz + vec2(0.0, eps));
    vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
    float diffuse = max(dot(normal, lightDir), 0.15);

    vec2 mapSize = uHeightMapBounds.zw - uHeightMapBounds.xy;
    vec2 mapUv = (vWorldPos.xz - uHeightMapBounds.xy) / mapSize;
    vec3 mapBase = uUseColorMap && all(greaterThanEqual(mapUv, vec2(0.0))) && all(lessThanEqual(mapUv, vec2(1.0)))
      ? texture2D(uColorMap, mapUv).rgb
      : vec3(0.067, 0.243, 0.463);
    vec3 base = uShowLevelTint ? levelTint(vContinuousLevel) : mapBase;
    gl_FragColor = vec4(base * diffuse, 1.0);
  }
`;

export function createClipmapTerrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: TERRAIN_HEIGHT_GLSL + VERTEX_SHADER_BODY,
    fragmentShader: TERRAIN_HEIGHT_GLSL + FRAGMENT_SHADER_BODY,
    uniforms: {
      uCameraWorldPos: { value: new Vector3() },
      uBaseTileSizeM: { value: 0 },
      uGridResolution: { value: 1 },
      uMaxLevel: { value: 0 },
      uFinestSwitchDistanceM: { value: 0 },
      uHeightScale: { value: 1 },
      uBlockRadiusTiles: { value: 0 },
      uMorphEnabled: { value: true },
      uShowLevelTint: { value: true },
      uTerrainKind: { value: 0 },
      uUseHeightMap: { value: false },
      uHeightMap: { value: null },
      uHeightMapBounds: { value: new Vector4() },
      uHeightMapMinM: { value: 0 },
      uHeightMapRangeM: { value: 1 },
      uUseColorMap: { value: false },
      uColorMap: { value: null },
    },
    wireframe: false,
  });
}
