import type { TerrainVector3 } from '../core/terrain-math';
import type { ITerrainPatchMesh } from '../core/terrain-patch';
import type { IHierarchicalTerrainSurfaceDomain } from '../domains/terrain-surface-domain';

/** Context supplied to an optional terrain-surface patch selector. */
export interface ITerrainSurfaceSelectionRequest<TAddress> {
  readonly domain: IHierarchicalTerrainSurfaceDomain<TAddress>;
  readonly roots: readonly TAddress[];
  readonly cameraWorldM: TerrainVector3;
  readonly getLevel: (address: TAddress) => number;
  readonly getKey: (address: TAddress) => string;
  readonly maxLevel: number;
  /** Optional workload cap for selectors that support bounded refinement. */
  readonly maxPatches?: number;
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

/**
 * Optional draw-time visibility for resident terrain patches. A patch that
 * isn't visible stays resident (so turning the camera never exposes a hole
 * while a worker rebuilds it) but is skipped when drawing.
 *
 * `measure` runs once when a patch is installed; whatever it returns is kept
 * with the resident patch and handed back to `isVisible`, so the mesh arrays
 * don't have to stay alive. `isVisible` runs for every resident patch each
 * time selection runs, and once when a patch is installed. Freezing the LOD
 * freezes visibility too.
 */
export interface ITerrainSurfacePatchVisibility<TAddress, TBounds = unknown> {
  readonly measure: (address: TAddress, patch: ITerrainPatchMesh<TAddress>) => TBounds;
  readonly isVisible: (address: TAddress, bounds: TBounds) => boolean;
}
