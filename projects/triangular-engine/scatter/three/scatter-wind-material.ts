import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

import type { ScatterWindDefinition } from '../core/scatter-species-definition';

export interface IScatterWindHandle {
  /** Call once per frame (e.g. from `EngineService.elapsedTime$`) to advance the sway. */
  setTimeS(timeS: number): void;
  /**
   * Live-adjust the gust's peak extra amplitude without recompiling the
   * shader — useful for dialing a gust from off to exaggerated to confirm it
   * reads visually. No-op if `wind.gust` wasn't set (nothing to adjust).
   */
  setGustAmplitude(amplitude: number): void;
  /**
   * Live-adjust the curl-noise field's characteristic eddy size (in meters)
   * without recompiling. Smaller values read as many tight, choppy swirls;
   * larger values read as fewer, broader, slower-turning ones. No-op if
   * `wind.gust` wasn't set.
   */
  setGustWavelengthM(wavelengthM: number): void;
  /**
   * Live-adjust how fast the curl-noise field's domain drifts (roughly m/s)
   * without recompiling — higher makes eddies visibly travel and rotate
   * faster, useful for cranking a gust from barely-perceptible to obvious.
   * No-op if `wind.gust` wasn't set.
   */
  setGustDriftSpeedMS(driftSpeedMS: number): void;
}

export interface IScatterWindSwayOptions {
  /**
   * Consume a per-vertex `windWeight` geometry attribute (0..1) instead of
   * the default object-space-height heuristic. Lets a source that already
   * bakes a real per-vertex weight — e.g. `triangular-engine/procedural`
   * flora, which accounts for branch depth/thinness, not just how tall a
   * vertex is — drive the same sway instead of scatter re-deriving a cruder
   * approximation from `transformed.y`. Geometries without a `windWeight`
   * attribute must not set this (three.js has no vertex to bind otherwise).
   */
  readonly useVertexWindWeight?: boolean;
}

/**
 * Patches a material so every instance of an `InstancedMesh` sways in wind.
 * By default the weight is local +Y height — the base (object-space y=0)
 * stays put, the tip (higher y) swings furthest; pass
 * `useVertexWindWeight: true` to drive it from a baked `windWeight` vertex
 * attribute instead (see `IScatterWindSwayOptions`). Per-instance phase is
 * hashed from the instance's baked world position (`instanceMatrix[3]`) so a
 * field of grass/trees doesn't sway in lockstep. `wind.gust`, if present,
 * adds a second, *coherent* bend on top — a curl-noise flow field sampled at
 * each instance's world position, so nearby instances bend together (unlike
 * the per-instance-hashed base flutter) while the flow direction itself
 * swirls and drifts rather than pointing one fixed way. The curl is taken in
 * each instance's local tangent frame (derived from `instanceMatrix`'s
 * columns, which scatter's placement already orients to the surface normal),
 * so it works unmodified on a flat plane, a sphere, or the inside of a
 * cylinder. Time is driven externally via the returned handle rather than an
 * internal clock, so callers stay in control of the engine tick.
 */
export function enableScatterWindSway(
  material: Material,
  wind: ScatterWindDefinition,
  options: IScatterWindSwayOptions = {},
): IScatterWindHandle {
  const useVertexWindWeight = options.useVertexWindWeight === true;
  const gust = wind.gust;
  const timeUniform = { value: 0 };
  const gustAmplitudeUniform = { value: gust?.amplitude ?? 0 };
  const gustWavelengthUniform = { value: Math.max(gust?.wavelengthM ?? 1, 0.001) };
  const gustDriftSpeedUniform = { value: gust?.driftSpeedMS ?? 0 };
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  let gustFunctions = '';
  let gustCode = '';
  const swayAmplitude = wind.strength.toFixed(6);
  let gustCacheKey = '';
  if (gust) {
    gustFunctions = `
float scatterGustHash(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.53));
  p += dot(p, p.yxz + 45.32);
  return fract(p.x * p.y * p.z);
}
float scatterGustNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(scatterGustHash(i + vec3(0.0,0.0,0.0)), scatterGustHash(i + vec3(1.0,0.0,0.0)), u.x),
        mix(scatterGustHash(i + vec3(0.0,1.0,0.0)), scatterGustHash(i + vec3(1.0,1.0,0.0)), u.x), u.y),
    mix(mix(scatterGustHash(i + vec3(0.0,0.0,1.0)), scatterGustHash(i + vec3(1.0,0.0,1.0)), u.x),
        mix(scatterGustHash(i + vec3(0.0,1.0,1.0)), scatterGustHash(i + vec3(1.0,1.0,1.0)), u.x), u.y),
    u.z
  );
}`;
    // Curl (gradient crossed with the local surface normal) is
    // divergence-free by construction — it can only rotate flow, never push
    // everything the same way, which is what keeps this from collapsing
    // into a straight diagonal line. instanceMatrix's columns are the
    // instance's local axes in world space, already oriented to the surface
    // normal by scatter's placement step, so projecting onto them (dot
    // product, since the axes are orthonormal) re-expresses the flow in
    // local space without needing a matrix inverse — this is what makes the
    // same code work on a flat plane, a sphere, or inside a cylinder.
    gustCode = `
#ifdef USE_INSTANCING
  vec3 scatterGustNormal = normalize(instanceMatrix[1].xyz);
  vec3 scatterGustLocalX = normalize(instanceMatrix[0].xyz);
  vec3 scatterGustLocalZ = normalize(instanceMatrix[2].xyz);
#else
  vec3 scatterGustNormal = vec3(0.0, 1.0, 0.0);
  vec3 scatterGustLocalX = vec3(1.0, 0.0, 0.0);
  vec3 scatterGustLocalZ = vec3(0.0, 0.0, 1.0);
#endif
  // Three axes advance at different rates (ratios lifted from a known-good
  // curl-noise wind reference, scaled up 3x from the first pass — the
  // original rates stayed imperceptibly slow even at the top of the drift
  // speed slider) so the noise field itself deforms over time instead of
  // sliding uniformly — otherwise curl noise sampled along a single moving
  // axis degenerates back into one traveling band. The overall rate is a
  // live uniform so drift speed can be dialed live, same as
  // amplitude/wavelength.
  vec3 scatterGustDrift = vec3(0.02, 0.0084, 0.0054) * scatterWindTimeS * scatterGustDriftSpeedMS;
  vec3 scatterGustSample = scatterInstanceOriginM / scatterGustWavelengthM + scatterGustDrift;
  const float scatterGustEps = 0.06;
  float scatterGustGx = scatterGustNoise(scatterGustSample + vec3(scatterGustEps, 0.0, 0.0)) - scatterGustNoise(scatterGustSample - vec3(scatterGustEps, 0.0, 0.0));
  float scatterGustGy = scatterGustNoise(scatterGustSample + vec3(0.0, scatterGustEps, 0.0)) - scatterGustNoise(scatterGustSample - vec3(0.0, scatterGustEps, 0.0));
  float scatterGustGz = scatterGustNoise(scatterGustSample + vec3(0.0, 0.0, scatterGustEps)) - scatterGustNoise(scatterGustSample - vec3(0.0, 0.0, scatterGustEps));
  vec3 scatterGustGrad = vec3(scatterGustGx, scatterGustGy, scatterGustGz) / (2.0 * scatterGustEps);
  vec3 scatterGustFlow = cross(scatterGustNormal, scatterGustGrad);
  vec2 scatterGustLocalFlow = vec2(dot(scatterGustFlow, scatterGustLocalX), dot(scatterGustFlow, scatterGustLocalZ));
  // Curl noise is smooth everywhere by construction (no edges) — masking the
  // flow by a contrast-shaped scalar of the same field carves it into
  // patches with a visible boundary (a "gust front") while the flow inside
  // each patch still swirls, instead of reintroducing a fixed-direction band
  // with one hard mechanical edge.
  float scatterGustCenter = scatterGustNoise(scatterGustSample);
  float scatterGustEdge = smoothstep(0.32, 0.62, scatterGustCenter);
  float scatterGustPunch = scatterGustEdge * scatterGustAmplitude * scatterWindWeight;
  transformed.x += scatterGustLocalFlow.x * scatterGustPunch;
  transformed.z += scatterGustLocalFlow.y * scatterGustPunch;`;
    // Drift speed is now a live uniform (not baked into this string), so the
    // generated GLSL is identical for every gust config — nothing to key on
    // beyond "gust is present", which the surrounding `if (gust)` already
    // captures via the uniform declarations below.
    gustCacheKey = '|scatterGustCurl';
  }

  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['scatterWindTimeS'] = timeUniform;
    if (gust) {
      shader.uniforms['scatterGustAmplitude'] = gustAmplitudeUniform;
      shader.uniforms['scatterGustWavelengthM'] = gustWavelengthUniform;
      shader.uniforms['scatterGustDriftSpeedMS'] = gustDriftSpeedUniform;
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float scatterWindTimeS;${useVertexWindWeight ? '\nattribute float windWeight;' : ''}${gust ? `\nuniform float scatterGustAmplitude;\nuniform float scatterGustWavelengthM;\nuniform float scatterGustDriftSpeedMS;${gustFunctions}` : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  vec3 scatterInstanceOriginM = instanceMatrix[3].xyz;
#else
  vec3 scatterInstanceOriginM = vec3(0.0);
#endif
  float scatterWindPhase = fract(sin(dot(scatterInstanceOriginM.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318530718;
  float scatterWindWeight = ${useVertexWindWeight ? 'windWeight' : 'max(transformed.y, 0.0)'};${gustCode}
  transformed.x += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase) * ${swayAmplitude} * scatterWindWeight;
  transformed.z += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase + 1.5707963) * ${swayAmplitude} * scatterWindWeight;
}`,
      );
  };
  // Three.js's shader program cache keys on `customProgramCacheKey()`, which
  // defaults to `onBeforeCompile.toString()` — identical source text across
  // every call to this function regardless of `wind`. Without this override,
  // two materials patched with different `wind` values collide on the same
  // cache key and Three.js silently reuses one's compiled program (with
  // whatever OTHER patches it has, e.g. dither) for the other's draw calls.
  material.customProgramCacheKey = () =>
    `${previousCacheKey()}|scatterWind:${wind.frequency.toFixed(6)}:${wind.strength.toFixed(6)}|windAttr:${useVertexWindWeight}${gustCacheKey}`;
  material.needsUpdate = true;

  return {
    setTimeS(timeS: number) {
      timeUniform.value = timeS;
    },
    setGustAmplitude(amplitude: number) {
      if (gust) gustAmplitudeUniform.value = amplitude;
    },
    setGustWavelengthM(wavelengthM: number) {
      if (gust) gustWavelengthUniform.value = Math.max(wavelengthM, 0.001);
    },
    setGustDriftSpeedMS(driftSpeedMS: number) {
      if (gust) gustDriftSpeedUniform.value = driftSpeedMS;
    },
  };
}
