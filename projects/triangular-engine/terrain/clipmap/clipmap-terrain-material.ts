import { ShaderMaterial, Vector3, Vector4 } from 'three';
import { BENCHMARK_TERRAIN_GLSL } from './clipmap-benchmark-fixtures';

/**
 * Stand-in for a real `sampleElevation()`/`height(dir)`. Texture-backed
 * heightmaps are a separate concern (see clipmap-constants.ts doc comment) —
 * this module is only about the LOD/morph mechanism, so an analytic function
 * keeps the fixture boundless and avoids atlas/streaming complexity entirely.
 * Extend or replace this GLSL block to plug in real terrain sampling.
 */
const TERRAIN_HEIGHT_GLSL = `
  uniform float uTerrainKind; // 0=wave, 1=noise, 2=peaks, 3=ridges, 4=terraces, 5=field
  uniform bool uUseHeightMap;
  uniform sampler2D uHeightMap;
  uniform vec4 uHeightMapBounds; // minX, minZ, maxX, maxZ
  uniform float uHeightMapMinM;
  uniform float uHeightMapRangeM;
  uniform float uHeightSampleStepM;
  uniform bool uUseColorMap;
  uniform sampler2D uColorMap;
  uniform bool uMacroVariationEnabled;
  uniform float uMacroVariationStrength;
  uniform float uMacroVariationScaleM;

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
    // Use one initialized result for every path. ANGLE's HLSL translator can
    // otherwise report its generated function return variable as potentially
    // uninitialized even though the early-return branches are logically total.
    float height = 0.0;
    if (uUseHeightMap) {
      // A bounded real source owns the map. Do not leak the analytic spike
      // terrain outside its bounds; the clipmap can cover a larger area than
      // a first-pass bake. Keep the exterior at the shared sea datum until a
      // streamed/larger source is available.
      if (all(greaterThanEqual(mapUv, vec2(0.0))) && all(lessThanEqual(mapUv, vec2(1.0)))) {
        height = uHeightMapMinM + texture2D(uHeightMap, mapUv).r * uHeightMapRangeM;
      }
    } else {
      if (uTerrainKind < 0.5) height = terrainHeightWave(xz);
      else if (uTerrainKind < 1.5) height = terrainHeightNoise(xz);
      else {
        // Deterministic benchmark fixtures (clipmap-benchmark-fixtures.ts).
        // These are generated from the same constants the CPU fidelity harness
        // evaluates, so the rendered mesh and ground truth cannot diverge.
        if (uTerrainKind < 2.5) height = terrainHeightBenchmarkPeaks(xz);
        else if (uTerrainKind < 3.5) height = terrainHeightBenchmarkRidges(xz);
        else if (uTerrainKind < 4.5) height = terrainHeightBenchmarkTerraces(xz);
        else height = terrainHeightBenchmarkField(xz);
      }
    }
    return height;
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
  // logdepthbuf_vertex uses isPerspectiveMatrix(), supplied by common.
  #include <common>

  // The scene enables logarithmic depth for the real-scale planet. Custom
  // ShaderMaterials must include the renderer chunks explicitly; otherwise
  // they continue writing ordinary depth while the rest of the scene uses the
  // logarithmic depth path.
  #include <logdepthbuf_pars_vertex>

  uniform vec3 uCameraWorldPos;
  uniform float uBaseTileSizeM;
  uniform float uGridResolution;
  uniform float uMaxLevel;
  uniform float uFinestSwitchDistanceM;
  uniform float uHeightScale;
  uniform float uBlockRadiusTiles;
  uniform bool uMorphEnabled;
  uniform bool uDebugFlatTerrain;

  uniform vec4 uLevelBounds[16];

  attribute vec3 instanceOffset;
  attribute float instanceScale;

  varying float vContinuousLevel;
  varying vec3 vWorldPos;
  varying float vTileLevel;
  varying float vBorderBlend;

  // A level's real rendered vertex spacing: clipmap-grid-geometry.ts strides
  // its shared index buffer by 2^level, but clamps that stride at
  // uGridResolution (levels whose stride would exceed it just reuse the
  // coarsest 1-quad-per-tile geometry — see that file's per-level loop).
  float realVertexSpacingM(float level) {
    float clampedStride = min(pow(2.0, level), uGridResolution);
    return (clampedStride / uGridResolution) * uBaseTileSizeM * pow(2.0, level);
  }

  // WebGL 1 / GLES 2 shader compilers commonly require uniform-array indices
  // to be compile-time constants. Keep the level bounds in a uniform array so
  // the CPU can update them, but select entries through constant-index
  // branches instead of a runtime array index.
  vec4 levelBounds(float level) {
    if (level < 0.5) return uLevelBounds[0];
    if (level < 1.5) return uLevelBounds[1];
    if (level < 2.5) return uLevelBounds[2];
    if (level < 3.5) return uLevelBounds[3];
    if (level < 4.5) return uLevelBounds[4];
    if (level < 5.5) return uLevelBounds[5];
    if (level < 6.5) return uLevelBounds[6];
    if (level < 7.5) return uLevelBounds[7];
    if (level < 8.5) return uLevelBounds[8];
    if (level < 9.5) return uLevelBounds[9];
    if (level < 10.5) return uLevelBounds[10];
    if (level < 11.5) return uLevelBounds[11];
    if (level < 12.5) return uLevelBounds[12];
    if (level < 13.5) return uLevelBounds[13];
    if (level < 14.5) return uLevelBounds[14];
    return uLevelBounds[15];
  }

  void main() {
    vec2 localXZ = position.xz;
    // IMMUTABLE HORIZONTAL LATTICE: Vertices NEVER move horizontally in X/Z.
    // instanceOffset stores the tile centre in tile units, not metres. Adjacent
    // tiles therefore reconstruct a shared edge from the same grid coordinate
    // before multiplying by the large real-world tile size, avoiding visible
    // real-scale cracks caused by separately rounded metre expressions.
    vec2 worldXZ = (instanceOffset.xz + localXZ) * instanceScale;

    // Recover this tile's own instanced level from instanceScale
    float myLevel = floor(log2(instanceScale / uBaseTileSizeM) + 0.5);
    vTileLevel = myLevel;

    if (uDebugFlatTerrain) {
      vWorldPos = vec3(worldXZ.x, 0.0, worldXZ.y);
      vContinuousLevel = 0.0;
      vBorderBlend = 0.0;
      vec4 mvPosition = modelViewMatrix * vec4(vWorldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      return;
    }

    // Continuous distance LOD for shading/level tinting
    float dist = distance(uCameraWorldPos.xz, worldXZ);
    float continuousLevel = clamp(
      log2(max(dist, 1.0) / uFinestSwitchDistanceM),
      0.0,
      uMaxLevel
    );

    // Monotonic ring morph: a tile of level myLevel only morphs in the outer
    // portion of its own ring towards myLevel + 1. It never resets to 0 within
    // its own ring, eliminating the sawtooth detail pop at integer level boundaries.
    float morphAlpha = 0.0;
    if (uMorphEnabled && myLevel < uMaxLevel - 0.5) {
      float rOuter = uFinestSwitchDistanceM * pow(2.0, myLevel);
      float rInner = myLevel > 0.5 ? (uFinestSwitchDistanceM * pow(2.0, myLevel - 1.0)) : 0.0;
      float rMorphStart = mix(rInner, rOuter, 0.5);
      morphAlpha = clamp((dist - rMorphStart) / max(rOuter - rMorphStart, 1.0), 0.0, 1.0);
    }

    // 1. Fine height sample at exact vertex coordinate
    float fineHeight = terrainHeight(worldXZ) * uHeightScale;

    // 2. Coarse grid spacing for this level's coarser neighbor (myLevel + 1)
    float coarseCell = realVertexSpacingM(min(myLevel + 1.0, uMaxLevel));

    // Bilinear coarse height in the tile interior
    float cX0 = floor(worldXZ.x / coarseCell) * coarseCell;
    float cX1 = cX0 + coarseCell;
    float cZ0 = floor(worldXZ.y / coarseCell) * coarseCell;
    float cZ1 = cZ0 + coarseCell;
    float uX = clamp((worldXZ.x - cX0) / coarseCell, 0.0, 1.0);
    float uZ = clamp((worldXZ.y - cZ0) / coarseCell, 0.0, 1.0);

    float ch00 = terrainHeight(vec2(cX0, cZ0)) * uHeightScale;
    float ch10 = terrainHeight(vec2(cX1, cZ0)) * uHeightScale;
    float ch01 = terrainHeight(vec2(cX0, cZ1)) * uHeightScale;
    float ch11 = terrainHeight(vec2(cX1, cZ1)) * uHeightScale;

    float coarseInteriorHeight = mix(mix(ch00, ch10, uX), mix(ch01, ch11, uX), uZ);
    float interiorHeight = mix(fineHeight, coarseInteriorHeight, morphAlpha);

    // 3. Exact linear edge height calculation for ring boundary touching myLevel + 1
    float finalHeight = interiorHeight;
    float borderBlend = 0.0;

    if (myLevel < uMaxLevel - 0.5) {
      vec4 levelBox = levelBounds(myLevel);
      vec2 boxMin = levelBox.xy;
      vec2 boxMax = levelBox.zw;
      if (boxMin.x == boxMax.x) {
        float tileSizeAtMyLevel = uBaseTileSizeM * pow(2.0, myLevel);
        float nextTileSize = tileSizeAtMyLevel * 2.0;
        vec2 centerTileAtMyLevel = floor(uCameraWorldPos.xz / nextTileSize) * 2.0;
        boxMin = (centerTileAtMyLevel - uBlockRadiusTiles) * tileSizeAtMyLevel;
        boxMax = (centerTileAtMyLevel + uBlockRadiusTiles) * tileSizeAtMyLevel;
      }

      vec2 distToMin = worldXZ - boxMin;
      vec2 distToMax = boxMax - worldXZ;
      vec2 distToEdge = min(distToMin, distToMax);
      float nearestEdgeDist = min(distToEdge.x, distToEdge.y);

      // The coarse neighbor edge is a straight 3D line segment connecting coarse vertices.
      // Fine boundary vertices evaluate the exact linear interpolation along that segment.
      float coarseEdgeH = interiorHeight;
      if (distToEdge.y < distToEdge.x) {
        // Closer to North or South boundary: edge is parallel to X, Z is constant
        float edgeZ = (distToMin.y < distToMax.y) ? boxMin.y : boxMax.y;
        float h0 = terrainHeight(vec2(cX0, edgeZ)) * uHeightScale;
        float h1 = terrainHeight(vec2(cX1, edgeZ)) * uHeightScale;
        coarseEdgeH = mix(h0, h1, uX);
      } else {
        // Closer to West or East boundary: edge is parallel to Z, X is constant
        float edgeX = (distToMin.x < distToMax.x) ? boxMin.x : boxMax.x;
        float h0 = terrainHeight(vec2(edgeX, cZ0)) * uHeightScale;
        float h1 = terrainHeight(vec2(edgeX, cZ1)) * uHeightScale;
        coarseEdgeH = mix(h0, h1, uZ);
      }

      borderBlend = uMorphEnabled
        ? (1.0 - clamp(nearestEdgeDist / coarseCell, 0.0, 1.0))
        : 0.0;

      if (borderBlend > 0.0) {
        finalHeight = mix(interiorHeight, coarseEdgeH, borderBlend);
      }
    }

    vWorldPos = vec3(worldXZ.x, finalHeight, worldXZ.y);
    vContinuousLevel = continuousLevel;
    vBorderBlend = borderBlend;

    vec4 mvPosition = modelViewMatrix * vec4(vWorldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER_BODY = `
  #include <common>

  // Keep fragment depth generation paired with the vertex shader above.
  #include <logdepthbuf_pars_fragment>

  uniform bool uShowLevelTint;
  uniform float uMaxLevel;
  uniform bool uDebugFlatTerrain;
  uniform int uDebugViewMode;
  varying float vContinuousLevel;
  varying vec3 vWorldPos;
  varying float vTileLevel;
  varying float vBorderBlend;

  vec3 discreteLevelColor(float level) {
    vec3 colors[12];
    colors[0]  = vec3(0.2, 0.8, 0.2); // green
    colors[1]  = vec3(0.2, 0.7, 0.9); // cyan
    colors[2]  = vec3(0.9, 0.8, 0.2); // yellow
    colors[3]  = vec3(0.9, 0.4, 0.2); // orange
    colors[4]  = vec3(0.9, 0.2, 0.3); // red
    colors[5]  = vec3(0.7, 0.2, 0.9); // purple
    colors[6]  = vec3(0.3, 0.3, 0.9); // blue
    colors[7]  = vec3(0.1, 0.9, 0.7); // teal
    colors[8]  = vec3(0.9, 0.2, 0.7); // pink
    colors[9]  = vec3(0.6, 0.9, 0.2); // lime
    colors[10] = vec3(0.9, 0.6, 0.5); // salmon
    colors[11] = vec3(0.5, 0.5, 0.5); // gray
    int idx = int(clamp(floor(level + 0.5), 0.0, 11.0));
    return colors[idx];
  }

  vec3 levelTint(float level) {
    vec3 colors[4];
    colors[0] = vec3(0.36, 0.78, 0.42);
    colors[1] = vec3(0.32, 0.62, 0.86);
    colors[2] = vec3(0.92, 0.75, 0.28);
    colors[3] = vec3(0.86, 0.34, 0.34);
    // Spread the 4-color gradient across the whole 0..uMaxLevel range
    float t = clamp(level / max(uMaxLevel, 1.0) * 3.0, 0.0, 3.0);
    int i0 = int(floor(t));
    int i1 = min(i0 + 1, 3);
    return mix(colors[i0], colors[i1], fract(t));
  }

  // A low-frequency, planet-space breakup signal. The second sample uses a
  // rotated coordinate basis so the two scales do not form an obvious grid.
  // The coordinates are world X/Z on the plane and can become a planet-space
  // direction in the spherical adapter without depending on mesh UVs.
  float terrainMacroVariation(vec2 xz) {
    float scaleM = max(uMacroVariationScaleM, 1.0);
    vec2 broadP = xz / scaleM + vec2(17.3, -9.1);
    mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);
    vec2 breakupP = rotate * (xz / (scaleM * 1.73)) + vec2(-23.1, 5.7);
    float broad = terrainValueNoise(broadP);
    float breakup = terrainValueNoise(breakupP);
    return mix(broad, breakup, 0.35);
  }

  void main() {
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
    float diffuse = 1.0;

    if (uDebugFlatTerrain) {
      diffuse = max(dot(vec3(0.0, 1.0, 0.0), lightDir), 0.35);
    } else {
      // A fixed metre-sized finite difference becomes effectively sub-texel
      // once the same bake is displayed over a real planetary footprint. Use
      // the physical size of a height texel instead, which keeps the normal
      // stable across legacy and planet-scale displays and avoids a regular
      // lighting pattern at the source texture's sampling boundaries.
      float eps = max(uHeightSampleStepM, 0.5);
      float hL = terrainHeight(vWorldPos.xz + vec2(-eps, 0.0));
      float hR = terrainHeight(vWorldPos.xz + vec2(eps, 0.0));
      float hD = terrainHeight(vWorldPos.xz + vec2(0.0, -eps));
      float hU = terrainHeight(vWorldPos.xz + vec2(0.0, eps));
      vec3 normal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
      diffuse = max(dot(normal, lightDir), 0.15);
    }

    vec2 mapSize = uHeightMapBounds.zw - uHeightMapBounds.xy;
    vec2 mapUv = (vWorldPos.xz - uHeightMapBounds.xy) / mapSize;
    vec3 mapBase = uUseColorMap && all(greaterThanEqual(mapUv, vec2(0.0))) && all(lessThanEqual(mapUv, vec2(1.0)))
      ? texture2D(uColorMap, mapUv).rgb
      : vec3(0.067, 0.243, 0.463);
    vec3 base = uShowLevelTint ? levelTint(vContinuousLevel) : mapBase;

    if (!uShowLevelTint && uMacroVariationEnabled && uUseColorMap) {
      float signedVariation = (terrainMacroVariation(vWorldPos.xz) - 0.5) * 2.0;
      // The first material pass has a colour map rather than a packed weight
      // map. These conservative colour heuristics keep macro breakup on land,
      // while avoiding dirtying blue water or whitening/darkening snow.
      float waterLike = smoothstep(0.16, 0.42, mapBase.b - mapBase.r);
      float snowLike = smoothstep(0.72, 0.94, dot(mapBase, vec3(0.333333)));
      float landFactor = 1.0 - clamp(waterLike + snowLike * 0.75, 0.0, 1.0);
      float amount = uMacroVariationStrength * landFactor;
      vec3 warmVariation = vec3(1.0) + signedVariation * vec3(0.12, 0.09, 0.055);
      base = mix(base, base * warmVariation, amount);
    }

    // Diagnostic view overrides
    if (uDebugViewMode == 1) {
      base = discreteLevelColor(vTileLevel);
    } else if (uDebugViewMode == 2) {
      base = levelTint(vContinuousLevel);
    } else if (uDebugViewMode == 3) {
      // Highlight border blend region in bright magenta
      base = mix(base, vec3(1.0, 0.0, 1.0), vBorderBlend);
    }

    gl_FragColor = vec4(base * diffuse, 1.0);
    #include <logdepthbuf_fragment>
  }
`;

export function createClipmapTerrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BENCHMARK_TERRAIN_GLSL + TERRAIN_HEIGHT_GLSL + VERTEX_SHADER_BODY,
    fragmentShader:
      BENCHMARK_TERRAIN_GLSL + TERRAIN_HEIGHT_GLSL + FRAGMENT_SHADER_BODY,
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
      uDebugFlatTerrain: { value: false },
      uDebugViewMode: { value: 0 },
      uTerrainKind: { value: 0 },
      uUseHeightMap: { value: false },
      uHeightMap: { value: null },
      uHeightMapBounds: { value: new Vector4() },
      uHeightMapMinM: { value: 0 },
      uHeightMapRangeM: { value: 1 },
      uHeightSampleStepM: { value: 0.5 },
      uUseColorMap: { value: false },
      uColorMap: { value: null },
      uMacroVariationEnabled: { value: false },
      uMacroVariationStrength: { value: 0.0 },
      uMacroVariationScaleM: { value: 32.0 },
      uLevelBounds: {
        value: Array.from({ length: 16 }, () => new Vector4()),
      },
    },
    wireframe: false,
  });
}
