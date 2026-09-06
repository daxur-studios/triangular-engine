import { ShaderMaterial, Vector3 } from 'three';

/**
 * Stand-in for a real `sampleElevation()`/`height(dir)`. Texture-backed
 * heightmaps are a separate concern (see constants.ts doc comment) — this
 * spike is only about the LOD/morph mechanism, so an analytic function keeps
 * the fixture boundless and avoids atlas/streaming complexity entirely.
 */
const TERRAIN_HEIGHT_GLSL = `
  uniform float uTerrainKind; // 0 = wave (original), 1 = noise (fbm)

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
 * tile is instanced at — this is what makes *that* case crack-free, though it
 * does not by itself close the T-junction gap where a finer tile's edge has
 * vertices with no counterpart on a coarser neighbour (see clipmap-layout.ts
 * and shared-grid-geometry.ts).
 */
const VERTEX_SHADER_BODY = `
  uniform vec3 uCameraWorldPos;
  uniform float uBaseTileSizeM;
  uniform float uGridResolution;
  uniform float uMaxLevel;
  uniform float uFinestSwitchDistanceM;
  uniform float uHeightScale;
  uniform bool uMorphEnabled;

  attribute vec3 instanceOffset;
  attribute float instanceScale;

  varying float vContinuousLevel;
  varying vec3 vWorldPos;

  vec2 snapToGrid(vec2 p, float cell) {
    return floor(p / cell + 0.5) * cell;
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

    float vertexSpacingM = uBaseTileSizeM / uGridResolution;
    float fineCell = vertexSpacingM * pow(2.0, levelFloor);
    float coarseCell = vertexSpacingM * pow(2.0, levelFloor + 1.0);
    vec2 fineXZ = snapToGrid(seedWorldXZ, fineCell);
    vec2 coarseXZ = snapToGrid(seedWorldXZ, coarseCell);

    float heightFine = terrainHeight(fineXZ) * uHeightScale;
    float heightCoarse = terrainHeight(coarseXZ) * uHeightScale;

    vec2 morphedXZ = mix(fineXZ, coarseXZ, morphAlpha);
    float morphedHeight = mix(heightFine, heightCoarse, morphAlpha);

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
    float t = clamp(level, 0.0, 3.0);
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

    vec3 base = uShowLevelTint ? levelTint(vContinuousLevel) : vec3(0.55, 0.58, 0.45);
    gl_FragColor = vec4(base * diffuse, 1.0);
  }
`;

export function createGpuMorphLodMaterial(): ShaderMaterial {
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
      uMorphEnabled: { value: true },
      uShowLevelTint: { value: true },
      uTerrainKind: { value: 0 },
    },
    wireframe: false,
  });
}
