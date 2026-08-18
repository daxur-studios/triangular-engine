import { UniversalTime } from '../time/universal-clock';
import { IKeplerianElements, IStateVector } from './kepler-elements';
import { keplerianElementsToStateVector } from './state-elements';

/**
 * The concrete TypeScript form of the roadmap's conceptual `OrbitPropagator`
 * interface (map-view-mvp.md §5) — swappable later for rails/hyperbolic
 * propagators without changing call sites.
 */
export interface IOrbitPropagator {
  stateAt(
    elements: IKeplerianElements,
    mu: number,
    ut: UniversalTime,
  ): IStateVector;
}

/** Phase 2's only implementation: pure two-body elliptic Kepler propagation. */
export class KeplerianOrbitPropagator implements IOrbitPropagator {
  stateAt(
    elements: IKeplerianElements,
    mu: number,
    ut: UniversalTime,
  ): IStateVector {
    return keplerianElementsToStateVector(elements, mu, ut);
  }
}
