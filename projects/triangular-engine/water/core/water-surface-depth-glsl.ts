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
 * terrain-to-water separation along the water domain's local "up" normal.
 *
 * Unlike a view-Z subtraction, this is invariant to whether the domain is a
 * plane, a convex sphere, or the concave inside of a cylinder. The caller
 * supplies the domain-correct normal: +Y for a plane, outward for a sphere,
 * and inward (toward the axis) for an interior cylinder.
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
    vec3 waterWorldPosition,
    vec3 waterSurfaceNormal
  ) {
    vec3 sceneWorldPosition = waterSceneWorldPosition(screenUV);
    vec3 domainUp = normalize(waterSurfaceNormal);
    return max(
      dot(waterWorldPosition - sceneWorldPosition, domainUp),
      0.0
    );
  }
`;
