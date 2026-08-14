import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

import type { ScatterWindDefinition } from '../core/scatter-species-definition';

export interface IScatterWindHandle {
  /** Call once per frame (e.g. from `EngineService.elapsedTime$`) to advance the sway. */
  setTimeS(timeS: number): void;
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
 * field of grass/trees doesn't sway in lockstep. Time is driven externally
 * via the returned handle rather than an internal clock, so callers stay in
 * control of the engine tick.
 */
export function enableScatterWindSway(
  material: Material,
  wind: ScatterWindDefinition,
  options: IScatterWindSwayOptions = {},
): IScatterWindHandle {
  const useVertexWindWeight = options.useVertexWindWeight === true;
  const timeUniform = { value: 0 };
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['scatterWindTimeS'] = timeUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float scatterWindTimeS;${useVertexWindWeight ? '\nattribute float windWeight;' : ''}`,
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
  float scatterWindWeight = ${useVertexWindWeight ? 'windWeight' : 'max(transformed.y, 0.0)'};
  transformed.x += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase) * ${wind.strength.toFixed(6)} * scatterWindWeight;
  transformed.z += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase + 1.5707963) * ${wind.strength.toFixed(6)} * scatterWindWeight;
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
    `${previousCacheKey()}|scatterWind:${wind.frequency.toFixed(6)}:${wind.strength.toFixed(6)}|windAttr:${useVertexWindWeight}`;
  material.needsUpdate = true;

  return {
    setTimeS(timeS: number) {
      timeUniform.value = timeS;
    },
  };
}
