import { Vec3d, vec3Cross } from '../math/vec3';
import { quatApplyToVec3, quatFromAxisAngle } from '../math/quat';
import { REFERENCE_I, REFERENCE_K } from './reference-basis';

export interface IPerifocalBasis {
  /** Unit vector toward periapsis (or its canonical substitute in a singular case). */
  periapsisDirection: Vec3d;
  /** Unit vector 90 degrees ahead of `periapsisDirection`, in the direction of motion. */
  inPlaneDirection: Vec3d;
}

/**
 * Builds the orbital plane's basis from classical orientation elements by
 * three successive vector rotations — never an explicit rotation-matrix
 * formula re-derived in this non-standard (I, J, K) basis, which would be
 * easy to get sign-wrong. Each step rotates one physical axis about
 * another by one named angle:
 *
 * 1. the ascending node direction is `K`'s reference direction `I` rotated
 *    about `K` by `longitudeOfAscendingNodeRad`;
 * 2. the orbit normal is the reference pole `K` rotated about that node
 *    line by `inclinationRad`;
 * 3. the periapsis direction is the node line rotated about the orbit
 *    normal by `argumentOfPeriapsisRad`.
 *
 * The canonicalization rules in `stateVectorToKeplerianElements` (zeroed
 * angles, argument-of-latitude/true-longitude folded into the mean anomaly
 * field) make this same construction self-consistent for the circular
 * and/or equatorial singular cases too — no special-casing needed here.
 */
export function perifocalBasis(
  longitudeOfAscendingNodeRad: number,
  inclinationRad: number,
  argumentOfPeriapsisRad: number,
): IPerifocalBasis {
  const ascendingNode = quatApplyToVec3(
    quatFromAxisAngle(REFERENCE_K, longitudeOfAscendingNodeRad),
    REFERENCE_I,
  );
  const orbitNormal = quatApplyToVec3(
    quatFromAxisAngle(ascendingNode, inclinationRad),
    REFERENCE_K,
  );
  const periapsisDirection = quatApplyToVec3(
    quatFromAxisAngle(orbitNormal, argumentOfPeriapsisRad),
    ascendingNode,
  );
  const inPlaneDirection = vec3Cross(orbitNormal, periapsisDirection);

  return { periapsisDirection, inPlaneDirection };
}
