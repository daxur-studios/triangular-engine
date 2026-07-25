import { Matrix4, PerspectiveCamera } from 'three';

/**
 * Camera transforms used to reconstruct an opaque depth-prepass sample in
 * world space. This deliberately stays separate from the colour/fresnel
 * shading uniforms: it defines physical water thickness, not appearance.
 */
export interface WaterSurfaceDepthUniforms {
  uWaterProjectionMatrixInverse: { value: Matrix4 };
  uWaterCameraMatrixWorld: { value: Matrix4 };
}

export function createWaterSurfaceDepthUniforms(): WaterSurfaceDepthUniforms {
  return {
    uWaterProjectionMatrixInverse: { value: new Matrix4() },
    uWaterCameraMatrixWorld: { value: new Matrix4() },
  };
}

export function updateWaterSurfaceDepthCamera(
  uniforms: WaterSurfaceDepthUniforms,
  camera: PerspectiveCamera,
): void {
  uniforms.uWaterProjectionMatrixInverse.value.copy(
    camera.projectionMatrixInverse,
  );
  uniforms.uWaterCameraMatrixWorld.value.copy(camera.matrixWorld);
}

export const WATER_SURFACE_DEPTH_UNIFORMS_GLSL = `
  uniform mat4 uWaterProjectionMatrixInverse;
  uniform mat4 uWaterCameraMatrixWorld;
`;

/**
 * Reconstructs the opaque scene sample in world space, then measures the
 * ray distance from the water fragment to that sample. Since opaque geometry
 * is rendered before water, a surviving water fragment is in front of the
 * sample. Measuring along the viewing ray prevents distant terrain from being
 * mistaken for a zero-depth shoreline when it happens to be above a wave.
 *
 * `waterSceneViewZ` is provided by WATER_DEPTH_UNPACK_GLSL. Scaling a
 * projection-inverse far-plane ray by viewZ also works with logarithmic
 * depth, because only the reconstructed linear viewZ participates here.
 */
export const WATER_SURFACE_DEPTH_GLSL = `
  vec3 waterSceneWorldPosition(vec2 screenUV) {
    float sceneViewZ = waterSceneViewZ(screenUV);
    vec2 clipXY = screenUV * 2.0 - 1.0;
    vec4 viewRay = uWaterProjectionMatrixInverse * vec4(clipXY, 1.0, 1.0);
    vec3 viewPosition = viewRay.xyz * (sceneViewZ / viewRay.z);
    return (uWaterCameraMatrixWorld * vec4(viewPosition, 1.0)).xyz;
  }

  float waterSurfaceDepth(
    vec2 screenUV,
    vec3 waterWorldPosition
  ) {
    // A cleared depth texel contains sky, not an opaque surface at the far
    // plane. Treat it as open/deep water; reconstructing the far plane here
    // makes grazing-angle waves fade out along the undisplaced domain plane.
    float rawSceneDepth = texture2D(uSceneDepthTexture, screenUV).x;
    if (rawSceneDepth >= 0.999999) {
      return 1000000.0;
    }
    vec3 sceneWorldPosition = waterSceneWorldPosition(screenUV);
    return distance(waterWorldPosition, sceneWorldPosition);
  }
`;
