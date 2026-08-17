import type { TerrainVector3 } from 'triangular-engine/terrain';

function distanceM(a: TerrainVector3, b: TerrainVector3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function directionM(from: TerrainVector3, to: TerrainVector3, dist: number): TerrainVector3 {
  if (dist < 1e-6) return [0, 0, 0];
  return [(to[0] - from[0]) / dist, (to[1] - from[1]) / dist, (to[2] - from[2]) / dist];
}

function dot(a: TerrainVector3, b: TerrainVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Object-radius-widened angular half-size as seen from `distanceM` away —
 * shared by both tests below so a wide object survives a boundary a
 * point-sized one wouldn't. `atan`, not `asin`, since it stays well-behaved
 * as `objectRadiusM` approaches (or exceeds) `distanceM`.
 */
function angularRadiusRad(objectRadiusM: number, distM: number): number {
  if (distM < 1e-6) return Math.PI / 2;
  return Math.atan(objectRadiusM / distM);
}

/**
 * Conservative camera-relative cone test — full 3D angle between the
 * camera's forward direction and the direction to the candidate, widened by
 * the candidate's own angular radius so wide objects near the boundary
 * survive. Not a true 6-plane frustum (matches brunos-space-program's
 * cdlod-terrain-lab, which uses the same cheap cone). Full 3D (no XZ/up-axis
 * assumption) so it works unmodified under camera pitch and on any terrain
 * shape — a candidate straight below a camera looking straight down is
 * still just "some direction from the camera" to this test.
 */
export function computeScatterViewConeFade01(
  candidateWorldPositionM: TerrainVector3,
  viewpointWorldM: TerrainVector3,
  viewForwardM: TerrainVector3,
  coneHalfAngleRad: number,
  objectRadiusM = 0,
): number {
  const distM = distanceM(candidateWorldPositionM, viewpointWorldM);
  if (distM < 0.5) return 1;
  const candidateDirection = directionM(viewpointWorldM, candidateWorldPositionM, distM);
  const cosAngle = dot(candidateDirection, viewForwardM);
  const angleRad = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
  const widenedHalfAngleRad = coneHalfAngleRad + angularRadiusRad(objectRadiusM, distM);
  return angleRad <= widenedHalfAngleRad ? 1 : 0;
}

/**
 * Sphere-curvature horizon test — independent of view direction, pivoted at
 * the sphere's own center rather than the camera. Two angles from that
 * center: where the camera's line of sight grazes the sphere (`horizonAngle`,
 * from `acos(curvatureRadiusM / cameraDistanceFromCenterM)`), and how far
 * around the candidate sits from the camera (`centerAngle`). Ported from
 * CDLOD's horizon-occlusion pruning; sphere-only by construction (a cylinder
 * only curves circumferentially, not axially, so a single-center-point
 * horizon angle would be wrong there — see docs/runbook/017).
 */
export function computeScatterHorizonFade01(
  candidateWorldPositionM: TerrainVector3,
  viewpointWorldM: TerrainVector3,
  curvatureCenterWorldM: TerrainVector3,
  curvatureRadiusM: number,
  objectRadiusM = 0,
  marginRad = 0.12,
): number {
  const cameraDistM = distanceM(viewpointWorldM, curvatureCenterWorldM);
  const candidateDistM = distanceM(candidateWorldPositionM, curvatureCenterWorldM);
  if (cameraDistM < 1e-6 || candidateDistM < 1e-6) return 1;

  const camDirection = directionM(curvatureCenterWorldM, viewpointWorldM, cameraDistM);
  const candidateDirection = directionM(curvatureCenterWorldM, candidateWorldPositionM, candidateDistM);
  const centerAngle = Math.acos(Math.min(1, Math.max(-1, dot(camDirection, candidateDirection))));
  const objectAngularRadius = angularRadiusRad(objectRadiusM, candidateDistM);
  const nearestAngle = Math.max(0, centerAngle - objectAngularRadius);

  const horizonAngle = Math.acos(Math.min(1, curvatureRadiusM / cameraDistM));
  const behindHorizon = nearestAngle > horizonAngle + marginRad;
  return behindHorizon ? 0 : 1;
}
