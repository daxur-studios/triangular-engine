/**
 * Render-time shader chunks patched into a real material (e.g.
 * `MeshStandardMaterial`) via `onBeforeCompile` in
 * `octahedral-impostor-material.ts` — see that file for the exact
 * `#include` splice points. Ported from the reference octahedral-impostor
 * library's `shaders/impostor/octahedral_impostor_shader_*.glsl`, trimmed to
 * what that reference actually ships: hemispherical projection only (its
 * full-octahedral branch was never finished), always-on normal-map
 * blending (its `EZ_USE_NORMAL` toggle was permanently true), and no ORM /
 * parallax (both were commented-out scaffolding there too). `EZ_TRANSPARENT`
 * is kept — it's a real, exercised toggle in the reference.
 *
 * The vertex-side math projects the plane's local-space vertex onto the
 * baked sprite whose direction is nearest the camera, then blends the 3
 * nearest sprites (found via `computeSpritesWeight`) with barycentric
 * weights carried in `vSpritesWeight` — this is what makes the impostor
 * rotate smoothly instead of popping between discrete baked frames.
 */

export const IMPOSTOR_PARAMS_VERTEX_GLSL = /* glsl */ `
#include <clipping_planes_pars_vertex>

uniform mat4 impostorTransform;
uniform float spritesPerSide;

flat varying vec4 vSpritesWeight;
flat varying vec2 vSprite1;
flat varying vec2 vSprite2;
flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;

#ifdef IMPOSTOR_SPHERICAL
// Direction -> atlas-grid UV, full spherical octahedral projection (360°).
vec2 encodeDirection(vec3 direction) {
  vec3 octahedron = direction / (abs(direction.x) + abs(direction.y) + abs(direction.z));
  vec2 uv = (octahedron.y >= 0.0)
    ? vec2(octahedron.x, octahedron.z)
    : vec2((1.0 - abs(octahedron.z)) * (octahedron.x >= 0.0 ? 1.0 : -1.0),
           (1.0 - abs(octahedron.x)) * (octahedron.z >= 0.0 ? 1.0 : -1.0));
  return uv * 0.5 + 0.5;
}

// Inverse of fullOctahedronGridToDirection (see core/octahedron-directions.ts).
vec3 decodeDirection(vec2 gridIndex, vec2 spriteCountMinusOne) {
  vec2 uv = (gridIndex / spriteCountMinusOne) * 2.0 - 1.0;
  vec3 position = vec3(uv.x, 1.0 - abs(uv.x) - abs(uv.y), uv.y);
  if (position.y < 0.0) {
    float px = (1.0 - abs(uv.y)) * (uv.x >= 0.0 ? 1.0 : -1.0);
    float pz = (1.0 - abs(uv.x)) * (uv.y >= 0.0 ? 1.0 : -1.0);
    position.x = px;
    position.z = pz;
  }
  return normalize(position);
}
#else
// Direction -> atlas-grid UV, hemispherical octahedral projection (upper
// hemisphere only — a billboarded tree/rock is never viewed from below).
vec2 encodeDirection(vec3 direction) {
  vec3 octahedron = direction / dot(direction, sign(direction));
  return vec2(1.0 + octahedron.x + octahedron.z, 1.0 + octahedron.z - octahedron.x) * 0.5;
}

// Inverse of the bake-time hemiOctahedronGridToDirection (see
// core/octahedron-directions.ts) — must stay in lockstep with it, since one
// places the bake cameras and the other re-derives their directions here to
// pick/orient the baked sprites at render time.
vec3 decodeDirection(vec2 gridIndex, vec2 spriteCountMinusOne) {
  vec2 gridUV = gridIndex / spriteCountMinusOne;
  vec3 position = vec3(gridUV.x - gridUV.y, 0.0, -1.0 + gridUV.x + gridUV.y);
  position.y = 1.0 - abs(position.x) - abs(position.z);
  return normalize(position);
}
#endif

void computePlaneBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (abs(normal.y) > 0.999) up = vec3(-1.0, 0.0, 0.0);
  tangent = normalize(cross(up, normal));
  bitangent = cross(normal, tangent);
}

vec3 projectVertex(vec3 normal) {
  vec3 tangent, bitangent;
  computePlaneBasis(normal, tangent, bitangent);
  return tangent * position.x + bitangent * position.y;
}

void computeSpritesWeight(vec2 gridFract) {
  vSpritesWeight = vec4(
    min(1.0 - gridFract.x, 1.0 - gridFract.y),
    abs(gridFract.x - gridFract.y),
    min(gridFract.x, gridFract.y),
    ceil(gridFract.x - gridFract.y)
  );
}

vec2 projectToPlaneUV(vec3 normal, vec3 tangent, vec3 bitangent, vec3 cameraPosLocal, vec3 viewDir) {
  float denom = dot(viewDir, normal);
  float t = -dot(cameraPosLocal, normal) / denom;
  vec3 hit = cameraPosLocal + viewDir * t;
  return vec2(dot(tangent, hit), dot(bitangent, hit)) + 0.5;
}
`;

export const IMPOSTOR_VERTEX_GLSL = /* glsl */ `
vec2 spritesMinusOne = vec2(spritesPerSide - 1.0);

#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
mat4 transformedInstanceMatrix = instanceMatrix * impostorTransform;
vec3 cameraPosLocal = (inverse(transformedInstanceMatrix * modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
#else
vec3 cameraPosLocal = (inverse(impostorTransform * modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
#endif

vec3 cameraDir = normalize(cameraPosLocal);

vec3 projectedVertex = projectVertex(cameraDir);
vec3 viewDirLocal = normalize(projectedVertex - cameraPosLocal);

vec2 grid = encodeDirection(cameraDir) * spritesMinusOne;
vec2 gridFloor = min(floor(grid), spritesMinusOne);
vec2 gridFract = fract(grid);

computeSpritesWeight(gridFract);

vSprite1 = gridFloor;
vSprite2 = min(vSprite1 + mix(vec2(0.0, 1.0), vec2(1.0, 0.0), vSpritesWeight.w), spritesMinusOne);
vSprite3 = min(vSprite1 + vec2(1.0), spritesMinusOne);

vec3 spriteNormal1 = decodeDirection(vSprite1, spritesMinusOne);
vec3 spriteNormal2 = decodeDirection(vSprite2, spritesMinusOne);
vec3 spriteNormal3 = decodeDirection(vSprite3, spritesMinusOne);

vec3 planeX1, planeY1, planeX2, planeY2, planeX3, planeY3;
computePlaneBasis(spriteNormal1, planeX1, planeY1);
computePlaneBasis(spriteNormal2, planeX2, planeY2);
computePlaneBasis(spriteNormal3, planeX3, planeY3);

vSpriteUV1 = projectToPlaneUV(spriteNormal1, planeX1, planeY1, cameraPosLocal, viewDirLocal);
vSpriteUV2 = projectToPlaneUV(spriteNormal2, planeX2, planeY2, cameraPosLocal, viewDirLocal);
vSpriteUV3 = projectToPlaneUV(spriteNormal3, planeX3, planeY3, cameraPosLocal, viewDirLocal);

vec4 mvPosition = vec4(projectedVertex, 1.0);

#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
  mvPosition = transformedInstanceMatrix * mvPosition;
#else
  mvPosition = impostorTransform * mvPosition;
#endif

mvPosition = modelViewMatrix * mvPosition;

gl_Position = projectionMatrix * mvPosition;
`;

export const IMPOSTOR_PARAMS_FRAGMENT_GLSL = /* glsl */ `
#include <clipping_planes_pars_fragment>

uniform float spritesPerSide;
uniform float alphaClamp;

flat varying vec4 vSpritesWeight;
flat varying vec2 vSprite1;
flat varying vec2 vSprite2;
flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;

// Inlined rather than calling three's unpackRGBToNormal from <packing>:
// MeshStandardMaterial's fragment template doesn't include that chunk by
// default (only some other materials pull it in, e.g. for shadow-map depth
// packing), so the function isn't guaranteed to exist here.
vec3 unpackImpostorNormal(vec3 rgb) {
  return 2.0 * rgb - 1.0;
}

vec3 blendNormals(vec2 uv1, vec2 uv2, vec2 uv3) {
  vec3 normalDepth1 = unpackImpostorNormal(texture2D(normalMap, uv1).rgb);
  vec3 normalDepth2 = unpackImpostorNormal(texture2D(normalMap, uv2).rgb);
  vec3 normalDepth3 = unpackImpostorNormal(texture2D(normalMap, uv3).rgb);
  return normalize(normalDepth1 * vSpritesWeight.x + normalDepth2 * vSpritesWeight.y + normalDepth3 * vSpritesWeight.z);
}

vec2 getUV(vec2 localUv, vec2 frame, float frameSize) {
  vec2 clampedUv = clamp(localUv, vec2(0.0), vec2(1.0));
  return clamp(frameSize * (frame + clampedUv), vec2(0.0), vec2(1.0));
}
`;

export const IMPOSTOR_MAP_FRAGMENT_GLSL = /* glsl */ `
float spriteSize = 1.0 / spritesPerSide;

vec2 uv1 = getUV(vSpriteUV1, vSprite1, spriteSize);
vec2 uv2 = getUV(vSpriteUV2, vSprite2, spriteSize);
vec2 uv3 = getUV(vSpriteUV3, vSprite3, spriteSize);

vec4 sprite1, sprite2, sprite3;
float dominantWeightTest = 1.0 - alphaClamp;

// Skip sampling the dominant sprite's alpha twice, and discard early on a
// fully-transparent dominant sprite instead of paying for the other two
// samples and the blend below.
if (vSpritesWeight.x >= dominantWeightTest) {
  sprite1 = texture(map, uv1);
  if (sprite1.a <= alphaClamp) discard;
  sprite2 = texture(map, uv2);
  sprite3 = texture(map, uv3);
} else if (vSpritesWeight.y >= dominantWeightTest) {
  sprite2 = texture(map, uv2);
  if (sprite2.a <= alphaClamp) discard;
  sprite1 = texture(map, uv1);
  sprite3 = texture(map, uv3);
} else if (vSpritesWeight.z >= dominantWeightTest) {
  sprite3 = texture(map, uv3);
  if (sprite3.a <= alphaClamp) discard;
  sprite1 = texture(map, uv1);
  sprite2 = texture(map, uv2);
} else {
  sprite1 = texture(map, uv1);
  sprite2 = texture(map, uv2);
  sprite3 = texture(map, uv3);
}

vec4 blendedColor = sprite1 * vSpritesWeight.x + sprite2 * vSpritesWeight.y + sprite3 * vSpritesWeight.z;

if (blendedColor.a <= alphaClamp) discard;

#ifndef EZ_TRANSPARENT
  // Bake pass writes premultiplied-by-coverage alpha at atlas edges (see
  // create-octahedral-impostor-atlas.ts); un-premultiply here so an opaque
  // impostor doesn't get a dark fringe where sprites were blended against
  // a transparent clear color.
  blendedColor = vec4(blendedColor.rgb / blendedColor.a, 1.0);
#endif
`;

export const IMPOSTOR_NORMAL_FRAGMENT_BEGIN_GLSL = /* glsl */ `
vec3 normal = blendNormals(uv1, uv2, uv3);
vec3 nonPerturbedNormal = normal;
`;
