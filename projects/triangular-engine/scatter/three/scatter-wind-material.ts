import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

import type { ScatterWindDefinition } from '../core/scatter-species-definition';

export interface IScatterWindHandle {
  /** Call once per frame (e.g. from `EngineService.elapsedTime$`) to advance the sway. */
  setTimeS(timeS: number): void;
}

/**
 * Patches a material so every instance of an `InstancedMesh` sways in local
 * +Y-weighted wind — the base (object-space y=0) stays put, the tip (higher
 * y) swings furthest. Per-instance phase is hashed from the instance's baked
 * world position (`instanceMatrix[3]`) so a field of grass/trees doesn't
 * sway in lockstep. Time is driven externally via the returned handle rather
 * than an internal clock, so callers stay in control of the engine tick.
 */
export function enableScatterWindSway(
  material: Material,
  wind: ScatterWindDefinition,
): IScatterWindHandle {
  const timeUniform = { value: 0 };
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['scatterWindTimeS'] = timeUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float scatterWindTimeS;',
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
  float scatterWindWeight = max(transformed.y, 0.0);
  transformed.x += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase) * ${wind.strength.toFixed(6)} * scatterWindWeight;
  transformed.z += sin(scatterWindTimeS * ${wind.frequency.toFixed(6)} + scatterWindPhase + 1.5707963) * ${wind.strength.toFixed(6)} * scatterWindWeight;
}`,
      );
  };
  material.needsUpdate = true;

  return {
    setTimeS(timeS: number) {
      timeUniform.value = timeS;
    },
  };
}
