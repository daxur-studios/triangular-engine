import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Length, vec3Sub } from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import { bodyWorldStateAt } from './ephemeris';
import { IOrbitPropagator } from './propagator';

/**
 * `r_SOI = a * (mu_body / mu_parent)^(2/5)` (patched-conics.md decision 3).
 * Never stored on `ICelestialBody` — a derived value stored as data is the
 * mixed-mu pitfall (doc 03 §1) in a different costume.
 */
export function soiRadiusM(
  body: ICelestialBody,
  parent: ICelestialBody,
): number {
  const parentDistanceM =
    body.orbit?.semiMajorAxisM ??
    (body.fixedPositionRelativeToParentM
      ? vec3Length(body.fixedPositionRelativeToParentM)
      : undefined);
  if (parentDistanceM === undefined) {
    throw new Error(
      `soiRadiusM: body '${body.id}' has no orbit or fixed position`,
    );
  }
  return parentDistanceM * Math.pow(body.muM3PerS2 / parent.muM3PerS2, 2 / 5);
}

/**
 * The deepest body whose sphere of influence contains `worldPositionM` at
 * `ut` — patched conics' one-primary-at-a-time rule (patched-conics.md
 * decision 3). Walks down from the root body (infinite SOI, the fallback)
 * into whichever child's SOI actually contains the position, recursing into
 * that child's own children.
 */
export function primaryBodyAt(
  bodies: readonly ICelestialBody[],
  worldPositionM: Vec3d,
  ut: UniversalTime,
  propagator: IOrbitPropagator,
): ICelestialBody {
  const rootBody = bodies.find(
    (body) =>
      !body.parentBodyId ||
      !bodies.some((candidate) => candidate.id === body.parentBodyId),
  );
  if (!rootBody) {
    throw new Error(
      'primaryBodyAt: no root body (a body with no parentBodyId) in the given set',
    );
  }

  return deepestContainingBody(rootBody);

  function deepestContainingBody(candidate: ICelestialBody): ICelestialBody {
    const children = bodies.filter(
      (body) => body.parentBodyId === candidate.id,
    );
    for (const child of children) {
      const childWorldState = bodyWorldStateAt(
        bodies,
        child.id,
        ut,
        propagator,
      );
      const distanceM = vec3Length(
        vec3Sub(worldPositionM, childWorldState.positionM),
      );
      if (distanceM <= soiRadiusM(child, candidate)) {
        return deepestContainingBody(child);
      }
    }
    return candidate;
  }
}
