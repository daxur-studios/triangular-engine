import { Camera, Vector3 } from 'three';
import { CsmAdaptiveRange, CsmAdaptiveResult } from './csm.model';

const _cameraPos = new Vector3();
const _centerVec = new Vector3();

/**
 * Computes altitude-adaptive CSM shadow distance and intensity for planetary / orbit scales.
 *
 * When close to the ground, returns a tight shadow distance for razor-sharp contact shadows.
 * When rising into orbit, scales shadow distance outward to maintain landscape coverage,
 * then smoothly attenuates CSM intensity above `fadeOutAltitude` so shadows fade cleanly
 * into the planet's native day/night terminator without jarring pops or wasted draw calls.
 */
export function calculateCsmAdaptiveRange(
  camera: Camera,
  config: CsmAdaptiveRange,
): CsmAdaptiveResult {
  camera.getWorldPosition(_cameraPos);

  const centerTuple = config.center ?? [0, 0, 0];
  _centerVec.set(centerTuple[0], centerTuple[1], centerTuple[2]);

  const distToCenter = _cameraPos.distanceTo(_centerVec);
  const surfaceRadius = config.surfaceRadius;
  const altitude = Math.max(0, distToCenter - surfaceRadius);

  const minDistance = config.minDistance ?? 200;
  const maxDistance = config.maxDistance ?? 3000;
  const altitudeScale = config.altitudeScale ?? 1.5;

  const scaledDist = minDistance + altitude * altitudeScale;
  const effectiveMaxDistance = Math.max(
    minDistance,
    Math.min(maxDistance, scaledDist),
  );

  const fadeStart = config.fadeOutAltitude ?? 2500;
  const fadeEnd = config.maxFadeAltitude ?? Math.max(fadeStart + 1000, 6000);

  let shadowFactor = 1.0;
  if (altitude >= fadeEnd) {
    shadowFactor = 0.0;
  } else if (altitude > fadeStart) {
    const t = (altitude - fadeStart) / (fadeEnd - fadeStart);
    shadowFactor = Math.max(0.0, Math.min(1.0, 1.0 - t));
  }

  return {
    maxDistance: effectiveMaxDistance,
    shadowFactor,
    altitude,
  };
}
