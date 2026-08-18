import { ICelestialBody } from '../bodies/celestial-body';
import {
  VEC3_ZERO,
  Vec3d,
  vec3Length,
  vec3Normalize,
  vec3Scale,
} from '../math/vec3';

/** `ρ(h) = ρ0·e^(−h/H)` (doc 03 §3/§5.5); 0 above `topAltitudeM` or when the body has no atmosphere. */
export function airDensity(body: ICelestialBody, altitudeM: number): number {
  const atmosphere = body.atmosphere;
  if (!atmosphere || altitudeM >= atmosphere.topAltitudeM) return 0;
  return (
    atmosphere.seaLevelDensityKgM3 *
    Math.exp(-altitudeM / atmosphere.scaleHeightM)
  );
}

/**
 * Whole-vessel v² drag (A0 — per-part flat-plate drag is A2, Phase 8),
 * opposing the vessel's velocity relative to still air. `refAreaM2`/
 * `dragCoefficient` are the caller's fixed placeholder constants until a
 * per-part area model exists (launch-scene.md decision 4).
 */
export function dragForce(
  body: ICelestialBody,
  altitudeM: number,
  velocityMPerS: Vec3d,
  refAreaM2: number,
  dragCoefficient: number,
): Vec3d {
  const rho = airDensity(body, altitudeM);
  const speedMPerS = vec3Length(velocityMPerS);
  if (rho === 0 || speedMPerS === 0) return VEC3_ZERO;

  const magnitudeN =
    0.5 * rho * speedMPerS * speedMPerS * dragCoefficient * refAreaM2;
  return vec3Scale(vec3Normalize(velocityMPerS), -magnitudeN);
}
