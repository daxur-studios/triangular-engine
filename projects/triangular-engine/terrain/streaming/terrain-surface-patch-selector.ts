import type { TerrainVector3 } from '../core/terrain-math';
import type { IHierarchicalTerrainSurfaceDomain } from '../domains/terrain-surface-domain';

/** Context supplied to an optional terrain-surface patch selector. */
export interface ITerrainSurfaceSelectionRequest<TAddress> {
  readonly domain: IHierarchicalTerrainSurfaceDomain<TAddress>;
  readonly roots: readonly TAddress[];
  readonly cameraWorldM: TerrainVector3;
  readonly getLevel: (address: TAddress) => number;
  readonly getKey: (address: TAddress) => string;
  readonly maxLevel: number;
  readonly refinementDistanceM: number;
  readonly hysteresis: number;
  /** Whether the default selector refined this address on its previous update. */
  readonly wasRefined: (address: TAddress) => boolean;
}

/**
 * Optional LOD strategy for a terrain surface. Returning leaf patches keeps
 * meshing, nearby-first generation, retention, and render diagnostics shared.
 */
export type TerrainSurfacePatchSelector<TAddress> = (
  request: ITerrainSurfaceSelectionRequest<TAddress>,
) => readonly TAddress[];
