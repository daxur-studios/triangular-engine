import { ICelestialBody } from '../bodies/celestial-body';
import {
  BodyFrameSnapshot,
  BodyRotationOptions,
  bodyAngularVelocityAt,
  bodyOrientationAt,
} from '../frames/body-rotation';
import { VEC3_ZERO, vec3Add, vec3Sub } from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import { IStateVector } from './kepler-elements';
import { IOrbitPropagator } from './propagator';

function findBodyOrThrow(
  bodies: readonly ICelestialBody[],
  bodyId: string,
): ICelestialBody {
  const body = bodies.find((candidate) => candidate.id === bodyId);
  if (!body) {
    throw new Error(`findBodyOrThrow: no body with id '${bodyId}'`);
  }
  return body;
}

export interface BodyWorldStateOptions {
  /** If true, orbital translation of celestial bodies is frozen at `frozenUt` (or 0). */
  disableCelestialMovement?: boolean;
  frozenUt?: UniversalTime;
}

/**
 * The root-inertial (PCI) state of `bodyId` at `ut`, composing the parent
 * chain through `propagator` (patched-conics.md decision 2) — bodies ride
 * the same `IOrbitPropagator` vessels do, so the propagator interface can
 * never be bypassed by SOI/ephemeris logic. The root body (no
 * `parentBodyId`) returns zeros by definition: it *is* the origin of the
 * root frame (decision 1).
 */
export function bodyWorldStateAt(
  bodies: readonly ICelestialBody[],
  bodyId: string,
  ut: UniversalTime,
  propagator: IOrbitPropagator,
  options?: BodyWorldStateOptions,
): IStateVector {
  const body = findBodyOrThrow(bodies, bodyId);
  if (
    !body.parentBodyId ||
    !bodies.some((candidate) => candidate.id === body.parentBodyId)
  ) {
    return { positionM: VEC3_ZERO, velocityMPerS: VEC3_ZERO };
  }
  const parentStateM = bodyWorldStateAt(
    bodies,
    body.parentBodyId,
    ut,
    propagator,
    options,
  );
  if (body.fixedPositionRelativeToParentM) {
    if (body.orbit) {
      throw new Error(
        `bodyWorldStateAt: body '${bodyId}' cannot define both orbit and fixedPositionRelativeToParentM`,
      );
    }
    return {
      positionM: vec3Add(
        parentStateM.positionM,
        body.fixedPositionRelativeToParentM,
      ),
      velocityMPerS: parentStateM.velocityMPerS,
    };
  }
  if (!body.orbit) {
    throw new Error(
      `bodyWorldStateAt: body '${bodyId}' has a parentBodyId but no orbit or fixed position`,
    );
  }

  const parent = findBodyOrThrow(bodies, body.parentBodyId);

  if (options?.disableCelestialMovement) {
    const evalUt = options.frozenUt ?? 0;
    const relativeStateAtFreeze = propagator.stateAt(
      body.orbit,
      parent.muM3PerS2,
      evalUt,
    );
    return {
      positionM: vec3Add(
        parentStateM.positionM,
        relativeStateAtFreeze.positionM,
      ),
      velocityMPerS: parentStateM.velocityMPerS,
    };
  }

  const relativeState = propagator.stateAt(body.orbit, parent.muM3PerS2, ut);

  return {
    positionM: vec3Add(parentStateM.positionM, relativeState.positionM),
    velocityMPerS: vec3Add(
      parentStateM.velocityMPerS,
      relativeState.velocityMPerS,
    ),
  };
}

/**
 * `state` expressed relative to `bodyState` — the one subtraction
 * (decision 1) every live-physics/rails-frame conversion goes through, so
 * frame confusion (doc 03 §1's #1 handoff pitfall) has exactly one line to
 * audit.
 */
export function relativeStateTo(
  state: IStateVector,
  bodyState: IStateVector,
): IStateVector {
  return {
    positionM: vec3Sub(state.positionM, bodyState.positionM),
    velocityMPerS: vec3Sub(state.velocityMPerS, bodyState.velocityMPerS),
  };
}

/**
 * Creates one immutable body-frame snapshot combining ephemeris pose/velocity,
 * body rotation quaternion, and angular velocity vector at universal time `ut`.
 */
export function bodyFrameSnapshotAt(
  bodies: readonly ICelestialBody[],
  bodyId: string,
  ut: UniversalTime,
  propagator: IOrbitPropagator,
  options?: BodyWorldStateOptions & BodyRotationOptions,
): BodyFrameSnapshot {
  const body = findBodyOrThrow(bodies, bodyId);
  const worldState = bodyWorldStateAt(bodies, bodyId, ut, propagator, options);
  const rotation = bodyOrientationAt(body, ut, options);
  const angularVelocityRadPerS = bodyAngularVelocityAt(body, options);

  return {
    bodyId: body.id,
    ut,
    positionM: worldState.positionM,
    velocityMPerS: worldState.velocityMPerS,
    rotation,
    angularVelocityRadPerS,
  };
}
