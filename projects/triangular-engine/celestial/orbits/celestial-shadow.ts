import { Vec3d } from '../math/vec3';
import {
  celestialOcclusion,
  ICelestialOcclusionState,
  ILuminousDisc,
  IOccludingDisc,
} from './eclipse';

/**
 * Evaluates direct-light visibility at one receiver position.
 *
 * Keeping this as a pure receiver query lets terrain, vessels, buildings,
 * scatter, and future atmosphere consumers share exactly the same eclipse
 * result without renderer or body-name dependencies.
 */
export function celestialShadowAtReceiver(
  receiverPositionM: Vec3d,
  source: ILuminousDisc,
  occluders: readonly IOccludingDisc[],
): number {
  return celestialOcclusion(receiverPositionM, source, occluders)
    .visibleFraction01;
}

/** Returns the full diagnostic state for a receiver, useful for debug overlays and tests. */
export function celestialShadowStateAtReceiver(
  receiverPositionM: Vec3d,
  source: ILuminousDisc,
  occluders: readonly IOccludingDisc[],
): ICelestialOcclusionState {
  return celestialOcclusion(receiverPositionM, source, occluders);
}
