import type { AerialPerspectiveEffect } from '@takram/three-atmosphere';
import type { Ellipsoid } from '@takram/three-geospatial';
import { Vector3, type Camera, type Matrix4, type Uniform } from 'three';

type AerialCameraUniforms = Map<string, Uniform<number | Vector3>>;

type PatchableAerialEffect = {
  copyCameraSettings(camera: Camera): void;
  ellipsoid: Ellipsoid;
  uniforms: AerialCameraUniforms;
  worldToECEFMatrix: Matrix4;
};

const patchedEffects = new WeakSet<object>();

/**
 * Work around @takram/three-atmosphere 0.19.1 calculating the orbital
 * geometric-error blend from a WGS84 height even for a custom ellipsoid.
 */
export function applyTakramAerialCameraHeightFix(
  effect: AerialPerspectiveEffect,
): void {
  const patchable = effect as unknown as PatchableAerialEffect;
  if (patchedEffects.has(patchable)) return;

  const correction = patchable.uniforms.get('geometricErrorCorrectionAmount');
  if (!correction || typeof patchable.copyCameraSettings !== 'function') {
    throw new Error(
      'Unsupported @takram/three-atmosphere runtime: cannot install the custom-planet camera-height fix.',
    );
  }

  const original = patchable.copyCameraSettings.bind(patchable);
  const cameraPositionECEF = new Vector3();
  const projectedScale = new Vector3();
  patchable.copyCameraSettings = (camera: Camera): void => {
    original(camera);

    camera
      .getWorldPosition(cameraPositionECEF)
      .applyMatrix4(patchable.worldToECEFMatrix);
    const cameraHeight =
      cameraPositionECEF.length() - patchable.ellipsoid.maximumRadius;
    projectedScale
      .set(0, patchable.ellipsoid.maximumRadius, -Math.max(0, cameraHeight))
      .applyMatrix4(camera.projectionMatrix);
    correction.value = clamp01(remap(projectedScale.y, 41.5, 13.8, 0, 1));
  };
  patchedEffects.add(patchable);
}

function remap(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
): number {
  return (
    targetMin +
    ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin)
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
