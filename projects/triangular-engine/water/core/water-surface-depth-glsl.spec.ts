import { PerspectiveCamera, Vector3 } from 'three';
import {
  createWaterSurfaceDepthUniforms,
  updateWaterSurfaceDepthCamera,
  WATER_SURFACE_DEPTH_GLSL,
} from './water-surface-depth-glsl';

describe('water surface depth uniforms', () => {
  it('copies the current camera transforms without sharing matrix instances', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    camera.position.set(12, 34, 56);
    camera.lookAt(new Vector3(1, 2, 3));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const uniforms = createWaterSurfaceDepthUniforms();
    updateWaterSurfaceDepthCamera(uniforms, camera);

    expect(uniforms.uWaterProjectionMatrixInverse.value).not.toBe(
      camera.projectionMatrixInverse,
    );
    expect(
      uniforms.uWaterProjectionMatrixInverse.value.equals(
        camera.projectionMatrixInverse,
      ),
    ).toBeTrue();
    expect(uniforms.uWaterCameraMatrixWorld.value).not.toBe(camera.matrixWorld);
    expect(
      uniforms.uWaterCameraMatrixWorld.value.equals(camera.matrixWorld),
    ).toBeTrue();
  });

  it('treats cleared sky depth as open water instead of a far-plane surface', () => {
    expect(WATER_SURFACE_DEPTH_GLSL).toContain(
      'rawSceneDepth >= 0.999999',
    );
    expect(WATER_SURFACE_DEPTH_GLSL).toContain('return 1000000.0');
  });

  it('uses view-ray separation so distant terrain cannot erase foreground waves', () => {
    expect(WATER_SURFACE_DEPTH_GLSL).toContain(
      'distance(waterWorldPosition, sceneWorldPosition)',
    );
    expect(WATER_SURFACE_DEPTH_GLSL).not.toContain(
      'dot(waterWorldPosition - sceneWorldPosition',
    );
  });
});
