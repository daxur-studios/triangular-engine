import type {
  IHierarchicalTerrainSurfaceDomain,
  TerrainVector3,
} from 'triangular-engine/terrain';

export interface ISelectFixedLevelScatterCellsOptions<TAddress> {
  /** Finite starting addresses (e.g. a sphere's 6 faces, a cylinder's level-0 grid, or a windowed plane level-0 patch). */
  readonly roots: readonly TAddress[];
  readonly anchorWorldM: TerrainVector3;
  readonly radiusM: number;
  /** The layer's fixed identity-cell level — never the adaptive visual cut. */
  readonly fixedLevel: number;
  readonly getLevel: (address: TAddress) => number;
}

function distance(a: TerrainVector3, b: TerrainVector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Undisplaced patch centre plus the furthest corner distance from it — a conservative bounding radius for pruning. */
function patchCentreAndRadius<TAddress>(
  domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
  address: TAddress,
): { readonly centre: TerrainVector3; readonly radiusM: number } {
  const bounds = domain.getPatchBounds(address);
  const centre = domain.getSurfacePosition(
    address,
    (bounds.minU + bounds.maxU) / 2,
    (bounds.minV + bounds.maxV) / 2,
    0,
  );
  const corners: TerrainVector3[] = [
    domain.getSurfacePosition(address, bounds.minU, bounds.minV, 0),
    domain.getSurfacePosition(address, bounds.maxU, bounds.minV, 0),
    domain.getSurfacePosition(address, bounds.minU, bounds.maxV, 0),
    domain.getSurfacePosition(address, bounds.maxU, bounds.maxV, 0),
  ];
  let radiusM = 0;
  for (const corner of corners) {
    radiusM = Math.max(radiusM, distance(centre, corner));
  }
  return { centre, radiusM };
}

/**
 * Selects every terrain patch address at exactly `fixedLevel` intersecting a
 * world-space anchor + radius window. Deliberately not the adaptive visual
 * cut (`selectAdaptiveTerrainPatches`): scatter identity cells must stay
 * fixed regardless of camera distance, or instances would regenerate under
 * different addresses. See docs/runbook/005_scatter_sublibrary.md.
 */
export function selectFixedLevelScatterCells<TAddress>(
  domain: IHierarchicalTerrainSurfaceDomain<TAddress>,
  options: ISelectFixedLevelScatterCellsOptions<TAddress>,
): readonly TAddress[] {
  if (
    !options.anchorWorldM.every(Number.isFinite) ||
    !Number.isFinite(options.radiusM) ||
    options.radiusM < 0 ||
    !Number.isInteger(options.fixedLevel) ||
    options.fixedLevel < 0
  ) {
    throw new RangeError('Fixed-level scatter cell selection options are invalid.');
  }

  const selected: TAddress[] = [];
  const visit = (address: TAddress): void => {
    const level = options.getLevel(address);
    const { centre, radiusM: patchRadiusM } = patchCentreAndRadius(
      domain,
      address,
    );
    if (distance(centre, options.anchorWorldM) > options.radiusM + patchRadiusM) {
      return;
    }
    if (level >= options.fixedLevel) {
      if (level === options.fixedLevel) selected.push(address);
      return;
    }
    for (const child of domain.getChildren(address)) visit(child);
  };

  for (const root of options.roots) visit(root);
  return selected;
}
