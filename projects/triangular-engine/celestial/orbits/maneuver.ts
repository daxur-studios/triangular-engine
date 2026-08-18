import {
  Vec3d,
  vec3Add,
  vec3Cross,
  vec3Normalize,
  vec3Scale,
} from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import { IKeplerianElements } from './kepler-elements';
import {
  keplerianElementsToStateVector,
  stateVectorToKeplerianElements,
} from './state-elements';

/**
 * A single planning-only Δv, expressed in the local orbital triad at `ut`
 * (patched-conics.md decision 9) — bare-node scope: no execution assist, at
 * most one node held by a caller.
 */
export interface IManeuverNode {
  ut: UniversalTime;
  /** Along the velocity direction (`v̂`). */
  progradeDvMPerS: number;
  /** Along the orbit-normal direction (`ĥ`). */
  normalDvMPerS: number;
  /** Along `v̂ x ĥ` — outward from the body on a circular orbit. */
  radialDvMPerS: number;
}

/** The local orbital triad a maneuver node's Δv is expressed in, at `ut`. */
export interface IManeuverNodeBasis {
  /** `v̂` — along the velocity direction. */
  prograde: Vec3d;
  /** `ĥ` — the orbit-normal direction (`position × velocity`, normalized). */
  normal: Vec3d;
  /** `v̂ x ĥ` — outward from the body on a circular orbit. */
  radialOut: Vec3d;
}

/**
 * Derives the prograde/normal/radial-out unit-vector basis a maneuver
 * node's Δv triad is expressed in, from `elements` propagated to `ut`.
 * Shared by `applyManeuverNode` and by burn-tracking code that decomposes
 * measured thrust Δv onto the same axes (`plans/maneuver-node-burn-tracking.md`).
 */
export function maneuverNodeBasis(
  elements: IKeplerianElements,
  mu: number,
  ut: UniversalTime,
): IManeuverNodeBasis {
  const state = keplerianElementsToStateVector(elements, mu, ut);

  const prograde = vec3Normalize(state.velocityMPerS);
  const normal = vec3Normalize(vec3Cross(state.positionM, state.velocityMPerS));
  const radialOut = vec3Cross(prograde, normal);

  return { prograde, normal, radialOut };
}

/**
 * Applies `node`'s Δv impulsively at `node.ut`, returning the resulting
 * elements (still relative to the same body/`mu` — SOI effects come from
 * feeding the result to `predictTrajectory`, not from this function).
 */
export function applyManeuverNode(
  elements: IKeplerianElements,
  mu: number,
  node: IManeuverNode,
): IKeplerianElements {
  const state = keplerianElementsToStateVector(elements, mu, node.ut);
  const { prograde, normal, radialOut } = maneuverNodeBasis(
    elements,
    mu,
    node.ut,
  );

  const deltaV: Vec3d = vec3Add(
    vec3Add(
      vec3Scale(prograde, node.progradeDvMPerS),
      vec3Scale(normal, node.normalDvMPerS),
    ),
    vec3Scale(radialOut, node.radialDvMPerS),
  );

  return stateVectorToKeplerianElements(
    {
      positionM: state.positionM,
      velocityMPerS: vec3Add(state.velocityMPerS, deltaV),
    },
    mu,
    node.ut,
  );
}
