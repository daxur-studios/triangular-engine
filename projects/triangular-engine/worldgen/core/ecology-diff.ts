import { IPlanetEcology } from './ecology';

export interface IPlanetEcologyDiff {
  /** Cell ids whose `biome` differs between the two snapshots. */
  biomeChangedCellIds: number[];
  /** Cell ids whose `waterBodyKind` differs, including `null` <-> a kind (land flooding, or a
   * lake/ocean cell drying out). */
  waterBodyChangedCellIds: number[];
  /** `riverHeadwaterCornerId` values present in `next` but not `prev` — rivers that appeared. */
  riversAdded: number[];
  /** `riverHeadwaterCornerId` values present in `prev` but not `next` — rivers that vanished. */
  riversRemoved: number[];
}

/**
 * Compares two `IPlanetEcology` snapshots computed on the *same* graph (e.g. `prev`/`next` a
 * time-step apart) and reports what actually changed, by stable id — cell id for biome/water
 * body, `riverHeadwaterCornerId` for rivers. Never diff `riverPaths` by array position: a
 * headwater that freezes out or thaws in shifts every later entry's index, so position isn't a
 * river's identity across recomputes even though the same headwater corner deterministically is.
 *
 * O(cell count + corner count) per call — a flat scan, no persisted diff-state to keep in sync
 * with the recompute that produced `next`. That cost is negligible next to the recompute itself
 * (climate/biome/river tracing), so call this as often as you recompute rather than trying to
 * special-case it; the real performance lever is how often a game recomputes at all, not how
 * cheaply it can diff two already-computed snapshots.
 */
export function diffPlanetEcology(prev: IPlanetEcology, next: IPlanetEcology): IPlanetEcologyDiff {
  const biomeChangedCellIds: number[] = [];
  for (let i = 0; i < next.biome.length; i++) {
    if (prev.biome[i] !== next.biome[i]) biomeChangedCellIds.push(i);
  }

  const waterBodyChangedCellIds: number[] = [];
  for (let i = 0; i < next.waterBodyKind.length; i++) {
    if (prev.waterBodyKind[i] !== next.waterBodyKind[i]) waterBodyChangedCellIds.push(i);
  }

  const prevHeadwaters = new Set(prev.riverHeadwaterCornerId);
  const nextHeadwaters = new Set(next.riverHeadwaterCornerId);
  const riversAdded = next.riverHeadwaterCornerId.filter((id) => !prevHeadwaters.has(id));
  const riversRemoved = prev.riverHeadwaterCornerId.filter((id) => !nextHeadwaters.has(id));

  return { biomeChangedCellIds, waterBodyChangedCellIds, riversAdded, riversRemoved };
}
