import { PerspectiveCamera, Vector3 } from 'three';
import {
  createWaterSurfaceDepthUniforms,
  updateWaterSurfaceDepthCamera,
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
    expect(uniforms.uWaterProjectionMatrixInverse.value.equals(
      camera.projectionMatrixInverse,
    )).toBeTrue();
    expect(uniforms.uWaterCameraMatrixWorld.value).not.toBe(camera.matrixWorld);
    expect(
      uniforms.uWaterCameraMatrixWorld.value.equals(camera.matrixWorld),
    ).toBeTrue();
  });
});
