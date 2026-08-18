import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Length, vec3Normalize, vec3Scale } from '../math/vec3';

/**
 * Newtonian spherical gravity as a PCI-space force toward the body's
 * center — a swap-in `ForceRequest` (doc 05 D4). The caller rotates the
 * result into vessel-local space and pushes it onto the same `requests`
 * array `simulateVesselTick` returned.
 */
export function sphericalGravityForce(
  body: ICelestialBody,
  vesselPositionM: Vec3d,
  massKg: number,
): Vec3d {
  const distanceM = vec3Length(vesselPositionM);
  const magnitudeN = (body.muM3PerS2 * massKg) / (distanceM * distanceM);
  return vec3Scale(vec3Normalize(vesselPositionM), -magnitudeN);
}
