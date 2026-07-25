import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

export interface IScatterBillboardHandle {
  /**
   * Camera position for this frame, in the SAME anchor-relative space as the
   * instances (i.e. already offset by the `anchorWorldM` passed to
   * `buildScatterBillboardInstancedMesh`) — matching the convention every
   * other scatter/three transform uses to stay f32-safe at planetary radii.
   */
  setCameraWorldM(cameraWorldM: readonly [number, number, number]): void;
}

/**
 * Patches a material so `buildScatterBillboardInstancedMesh` instances
 * re-orient every frame to face the camera around their own `surfaceUp`
 * axis — a cylindrical billboard (tree silhouettes stay upright and never
 * tilt sideways as the camera pitches), not a fully spherical one. Reads
 * per-instance `instanceOriginM` / `instanceScale` / `instanceSurfaceUp`
 * attributes written by that builder instead of the mesh-tier's baked
 * `instanceMatrix` rotation, since a billboard's orientation is recomputed
 * per frame rather than baked once at placement time.
 */
export function enableScatterCylindricalBillboard(
  material: Material,
): IScatterBillboardHandle {
  const cameraWorldUniform = { value: [0, 0, 0] };
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms['scatterBillboardCameraWorldM'] = cameraWorldUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 scatterBillboardCameraWorldM;
attribute vec3 instanceOriginM;
attribute float instanceScale;
attribute vec3 instanceSurfaceUp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec3 scatterUp = normalize(instanceSurfaceUp);
  vec3 scatterToCamera = scatterBillboardCameraWorldM - instanceOriginM;
  vec3 scatterToCameraFlat = scatterToCamera - scatterUp * dot(scatterToCamera, scatterUp);
  float scatterToCameraFlatLen = length(scatterToCameraFlat);
  vec3 scatterForward = scatterToCameraFlatLen > 0.0001
    ? scatterToCameraFlat / scatterToCameraFlatLen
    : vec3(0.0, 0.0, 1.0);
  vec3 scatterRight = normalize(cross(scatterUp, scatterForward));
  transformed = instanceOriginM
    + scatterRight * transformed.x * instanceScale
    + scatterUp * transformed.y * instanceScale;
}`,
      );
  };
  // See scatter-wind-material.ts for why this is required: `customProgramCacheKey()`
  // defaults to `onBeforeCompile.toString()`, which is identical source text on
  // every call — without a distinct tag here, materials patched with only this
  // function collide with any other single-purpose patch's cache key.
  material.customProgramCacheKey = () => `${previousCacheKey()}|scatterBillboard`;
  material.needsUpdate = true;

  return {
    setCameraWorldM(cameraWorldM: readonly [number, number, number]) {
      cameraWorldUniform.value = [cameraWorldM[0], cameraWorldM[1], cameraWorldM[2]];
    },
  };
}
