import { Color, Texture, Vector2 } from 'three';

/**
 * GLSL chunks for the water material's shading layer: fresnel reflectance,
 * a scrolling dual detail-normal perturbation ("fine chop" — see the Phase 0
 * finding in docs/runbook/002_water_sublibrary.md that this must live in
 * texture space, never the vertex grid), and depth-based shore fade / depth
 * tint sampled against `WaterDepthPrepass`'s opaque-scene depth texture.
 * Framework-free strings + uniform builders, composed into a full
 * ShaderMaterial by a consumer (see rendering/water-material-poc demo),
 * matching the pattern in gerstner-glsl.ts and water-lod-glsl.ts.
 */

export interface WaterShadingUniforms {
  uDetailNormalMap: { value: Texture | null };
  uDetailTiling: { value: number };
  uDetailScrollSpeed: { value: Vector2 };
  uDetailStrength: { value: number };
  uFresnelPower: { value: number };
  uColorShallow: { value: Color };
  uColorDeep: { value: Color };
  uAbsorptionDistance: { value: number };
  uSceneDepthTexture: { value: Texture | null };
  uResolution: { value: Vector2 };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
  uShoreFadeDistance: { value: number };
}

export interface WaterShadingOptions {
  readonly detailNormalMap?: Texture | null;
  readonly detailTiling?: number;
  readonly detailScrollSpeed?: readonly [number, number];
  readonly detailStrength?: number;
  readonly fresnelPower?: number;
  readonly colorShallow?: Color | string;
  readonly colorDeep?: Color | string;
  readonly absorptionDistance?: number;
  readonly shoreFadeDistance?: number;
}

function resolveColor(value: Color | string | undefined, fallback: string): Color {
  if (value instanceof Color) return value;
  return new Color(value ?? fallback);
}

/** Builds a fresh uniforms object for `WATER_SHADING_UNIFORMS_GLSL`'s declarations. */
export function createWaterShadingUniforms(
  options: WaterShadingOptions = {},
): WaterShadingUniforms {
  return {
    uDetailNormalMap: { value: options.detailNormalMap ?? null },
    uDetailTiling: { value: options.detailTiling ?? 8 },
    uDetailScrollSpeed: {
      value: new Vector2(...(options.detailScrollSpeed ?? [0.05, 0.03])),
    },
    uDetailStrength: { value: options.detailStrength ?? 0.5 },
    uFresnelPower: { value: options.fresnelPower ?? 3 },
    uColorShallow: { value: resolveColor(options.colorShallow, '#8fe3ff') },
    uColorDeep: { value: resolveColor(options.colorDeep, '#04283f') },
    uAbsorptionDistance: { value: options.absorptionDistance ?? 6 },
    uSceneDepthTexture: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 1000 },
    uShoreFadeDistance: { value: options.shoreFadeDistance ?? 2 },
  };
}

export const WATER_SHADING_UNIFORMS_GLSL = `
  uniform sampler2D uDetailNormalMap;
  uniform float uDetailTiling;
  uniform vec2 uDetailScrollSpeed;
  uniform float uDetailStrength;
  uniform float uFresnelPower;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  uniform float uAbsorptionDistance;
  uniform sampler2D uSceneDepthTexture;
  uniform vec2 uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uShoreFadeDistance;
`;

/**
 * Perturbs a (mostly-vertical) base normal with two scrolling copies of the
 * same tileable detail-normal texture, sampled at different tiling/speed so
 * their periodicity doesn't visibly align (classic dual-scroll technique,
 * same approach as three.js's `Water2.js`). The map's RGB is read directly
 * as a *world-aligned* normal (R=X, G=Z, B=Y) rather than tangent space — a
 * simplification that only holds because water is always close to
 * horizontal, the same assumption three.js's own water shaders make.
 */
export const WATER_DETAIL_NORMAL_GLSL = `
  vec3 waterDetailNormal(vec2 worldXZ, vec3 baseNormal, float t) {
    vec2 uvA = worldXZ / uDetailTiling + uDetailScrollSpeed * t;
    vec2 uvB = worldXZ / (uDetailTiling * 1.8) - uDetailScrollSpeed * 0.7 * t;
    vec3 sampleA = texture2D(uDetailNormalMap, uvA).rgb * 2.0 - 1.0;
    vec3 sampleB = texture2D(uDetailNormalMap, uvB).rgb * 2.0 - 1.0;
    vec3 detail = normalize(vec3(
      sampleA.x + sampleB.x,
      sampleA.z + sampleB.z,
      sampleA.y + sampleB.y
    ));
    return normalize(baseNormal + detail * uDetailStrength);
  }
`;

export const WATER_FRESNEL_GLSL = `
  float waterFresnel(vec3 normal, vec3 viewDir, float power) {
    return pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), power);
  }
`;

/**
 * Reconstructs linear view-space depth (three.js convention: negative in
 * front of the camera) from a standard non-linear depth texture — the same
 * formula as three.js's own `packing.glsl.js` `perspectiveDepthToViewZ`,
 * reproduced here so this module stays a self-contained string (no
 * `#include`, matching gerstner-glsl.ts / water-lod-glsl.ts's style).
 *
 * Branches on `USE_LOGARITHMIC_DEPTH_BUFFER`, which three.js's own
 * `WebGLProgram` auto-defines on *every* material — including a raw
 * `ShaderMaterial` like the water material — whenever the renderer was
 * constructed with `logarithmicDepthBuffer: true`. `WaterDepthPrepass`
 * renders through the same renderer with `MeshDepthMaterial`, a real
 * three.js material, so the depth texture it captures is log-encoded
 * whenever the app's renderer is; this reconstruction must match, or the
 * shore-fade/depth-tint math silently reads garbage (a standard-depth
 * inverse applied to a log-encoded value, or vice versa, does not merely
 * lose precision — it reconstructs a wrong-by-orders-of-magnitude `viewZ`).
 * Inverted from `logdepthbuf_fragment.glsl.js`'s write:
 * `winZ = log2(1.0 - viewZ) * logDepthBufFC * 0.5`, with
 * `logDepthBufFC = 2.0 / log2(far + 1.0)`, solved for `viewZ`. `near` plays
 * no part in the log encoding, so only `uCameraFar` is used on that branch.
 */
export const WATER_DEPTH_UNPACK_GLSL = `
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    float waterLogDepthToViewZ(float winZ, float far) {
      float fragDepth = pow(far + 1.0, winZ);
      return 1.0 - fragDepth;
    }

    float waterSceneViewZ(vec2 screenUV) {
      float depth = texture2D(uSceneDepthTexture, screenUV).x;
      return waterLogDepthToViewZ(depth, uCameraFar);
    }
  #else
    float waterPerspectiveDepthToViewZ(float invClipZ, float near, float far) {
      return (near * far) / ((far - near) * invClipZ - far);
    }

    float waterSceneViewZ(vec2 screenUV) {
      float depth = texture2D(uSceneDepthTexture, screenUV).x;
      return waterPerspectiveDepthToViewZ(depth, uCameraNear, uCameraFar);
    }
  #endif
`;

/**
 * Wires a custom water `ShaderMaterial` into three.js's logarithmic depth
 * buffer so its *own* rasterized depth (the hardware depth test used for
 * ordinary opaque occlusion, separate from the manual `uSceneDepthTexture`
 * comparison above) is encoded the same way as every built-in material in
 * the scene. Without this, water keeps writing standard perspective depth
 * even while `renderer.capabilities.logarithmicDepthBuffer` is true and the
 * shore/terrain mesh (a `MeshStandardMaterial`, log-encoded automatically)
 * is not — the two depth encodings are not comparable, so the hardware
 * depth test between water and terrain produces essentially arbitrary
 * occlusion at any real distance. `USE_LOGARITHMIC_DEPTH_BUFFER` and the
 * `logDepthBufFC` uniform are both auto-injected by three.js whenever the
 * renderer has log depth on (see `WebGLProgram`/`WebGLRenderer`), so these
 * four `#include`s are the entire fix — no extra uniforms to wire up, and
 * they no-op (compile to nothing) when log depth is off. Splice
 * `WATER_LOGDEPTH_PARS_VERTEX_GLSL` near the top of the vertex shader,
 * `WATER_LOGDEPTH_VERTEX_GLSL` immediately after `gl_Position` is assigned,
 * `WATER_LOGDEPTH_PARS_FRAGMENT_GLSL` near the top of the fragment shader,
 * and `WATER_LOGDEPTH_FRAGMENT_GLSL` last in `main()` (it writes
 * `gl_FragDepth`, so nothing after it should depend on the default depth).
 * `WATER_LOGDEPTH_PARS_VERTEX_GLSL` also pulls in three's `common` chunk —
 * `logdepthbuf_vertex`'s `isPerspectiveMatrix()` call depends on it, and
 * this module's other chunks declare no names that collide with it.
 */
export const WATER_LOGDEPTH_PARS_VERTEX_GLSL = `#include <common>\n#include <logdepthbuf_pars_vertex>`;
export const WATER_LOGDEPTH_VERTEX_GLSL = `#include <logdepthbuf_vertex>`;
export const WATER_LOGDEPTH_PARS_FRAGMENT_GLSL = `#include <logdepthbuf_pars_fragment>`;
export const WATER_LOGDEPTH_FRAGMENT_GLSL = `#include <logdepthbuf_fragment>`;

/**
 * Shore fade / depth tint: compares this water fragment's own view-space
 * depth (`fragViewZ`, e.g. from a `(viewMatrix * vec4(displaced, 1.0)).z`
 * varying) against the opaque scene depth at the same screen pixel
 * (captured by `WaterDepthPrepass` with water hidden). The result is how far
 * the opaque surface sits behind this fragment along the view ray — zero at
 * the shoreline, growing with distance offshore. Consumers use it to fade
 * alpha near shore and to mix toward `uColorDeep` with `uAbsorptionDistance`
 * as the falloff.
 */
export const WATER_DEPTH_FADE_GLSL = `
  float waterDepth(vec2 screenUV, float fragViewZ) {
    float sceneViewZ = waterSceneViewZ(screenUV);
    return max(fragViewZ - sceneViewZ, 0.0);
  }

  float waterShoreFade(float depth) {
    return clamp(depth / max(uShoreFadeDistance, 0.0001), 0.0, 1.0);
  }

  vec3 waterAbsorb(vec3 shallowColor, vec3 deepColor, float depth) {
    float t = 1.0 - exp(-depth / max(uAbsorptionDistance, 0.0001));
    return mix(shallowColor, deepColor, t);
  }
`;
