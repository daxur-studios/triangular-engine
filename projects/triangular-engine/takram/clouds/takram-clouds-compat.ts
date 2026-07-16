import type { CloudsEffect } from '@takram/three-clouds';
import { Vector3, type Camera, type Matrix4, type Uniform } from 'three';

type CloudCameraUniforms = {
  altitudeCorrection: Uniform<Vector3>;
  bottomRadius: Uniform<number>;
  cameraHeight: Uniform<number>;
  worldToECEFMatrix: Uniform<Matrix4>;
};

type CloudCameraMaterial = {
  copyCameraSettings(camera: Camera): void;
  uniforms: Partial<CloudCameraUniforms>;
};

const patchedMaterials = new WeakSet<object>();

/**
 * Work around @takram/three-clouds 0.7.6 projecting every camera against
 * WGS84 when it selects the below/inside/above-cloud shader branch.
 *
 * Takram's cloud pass and material are public, but their uniform shape is not
 * part of the declared API, so validate it before installing the shim. The
 * corrected position and radius intentionally match the spherical frame used
 * by the cloud shader. This is exact for the adapter's spherical planets.
 */
export function applyTakramCloudCameraHeightFix(effect: CloudsEffect): void {
  const material = effect.cloudsPass.currentMaterial as CloudCameraMaterial;
  if (patchedMaterials.has(material)) return;

  const uniforms = material.uniforms;
  if (
    !uniforms.altitudeCorrection ||
    !uniforms.bottomRadius ||
    !uniforms.cameraHeight ||
    !uniforms.worldToECEFMatrix ||
    typeof material.copyCameraSettings !== 'function'
  ) {
    throw new Error(
      'Unsupported @takram/three-clouds runtime: cannot install the custom-planet camera-height fix.',
    );
  }

  const original = material.copyCameraSettings.bind(material);
  const cameraPositionECEF = new Vector3();
  material.copyCameraSettings = (camera: Camera): void => {
    original(camera);
    camera
      .getWorldPosition(cameraPositionECEF)
      .applyMatrix4(uniforms.worldToECEFMatrix!.value)
      .add(uniforms.altitudeCorrection!.value);
    uniforms.cameraHeight!.value =
      cameraPositionECEF.length() - uniforms.bottomRadius!.value;
  };
  patchedMaterials.add(material);
}
