import type { TerrainVector3 } from '../core/terrain-math';
import type { IHierarchicalTerrainSurfaceDomain } from '../domains/terrain-surface-domain';

export interface IAdaptiveTerrainSelectionOptions<TAddress> {
  readonly roots: readonly TAddress[];
  readonly cameraWorldM: TerrainVector3;
  readonly getLevel: (address: TAddress) => number;
  readonly maxLevel: number;
  /** A level-zero patch refines inside this distance; each child halves it. */
  readonly refinementDistanceM: number;
}

function distance(a: TerrainVector3, b: TerrainVector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Selects a crack-coverable quadtree cut around a camera. Parents remain in the
 * result until all four children replace them, so the result always covers the
 * complete root set.
 */
export function selectAdaptiveTerrainPatches<TAddress>(
  domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
  options: IAdaptiveTerrainSelectionOptions<TAddress>,
): readonly TAddress[] {
  const { cameraWorldM, getLevel, maxLevel, refinementDistanceM } = options;
  if (
    !cameraWorldM.every(Number.isFinite) ||
    !Number.isInteger(maxLevel) ||
    maxLevel < 0 ||
    !Number.isFinite(refinementDistanceM) ||
    refinementDistanceM <= 0
  ) {
    throw new RangeError('Adaptive terrain selection options are invalid.');
  }

  const selected: TAddress[] = [];
  const visit = (address: TAddress): void => {
    const level = getLevel(address);
    const bounds = domain.getPatchBounds(address);
    const u = (bounds.minU + bounds.maxU) / 2;
    const v = (bounds.minV + bounds.maxV) / 2;
    const centre = domain.getSurfacePosition(address, u, v, 0);
    const refinementDistance = refinementDistanceM / 2 ** level;
    if (
      level < maxLevel &&
      distance(centre, cameraWorldM) < refinementDistance
    ) {
      for (const child of domain.getChildren(address)) visit(child);
    } else {
      selected.push(address);
    }
  };

  for (const root of options.roots) visit(root);
  return selected;
}
