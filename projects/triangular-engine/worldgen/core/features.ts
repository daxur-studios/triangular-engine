import { cellsWithinHops } from './terrain-edits';
import { defaultGeologicalTerrainSettings } from './geological-shapes';
import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { IPlanetTectonics } from './tectonics';
import { WaterBodyKind } from './water-bodies';

/**
 * A cell's dominant landform, layered on top of (not replacing) its climate `Biome` — see
 * runbook 022's "world profiles + per-cell terrain features" spike section. `'lava_lake'` is a
 * substance tag on an existing `'lake'` water-body cell near a volcano, not a shape stamp of its
 * own (see `computeFeatures()`'s doc comment for why this is a different mechanism from the
 * planet-scale molten-ocean case, which is a `WorldProfile.oceanSubstance` flag, not a `Feature`).
 */
export type Feature = 'none' | 'volcano' | 'mesa' | 'crater' | 'lava_lake';

export interface IFeatureParams {
  volcanoes?: boolean;
  mesas?: boolean;
  /** Impact craters — profile-agnostic (any profile can enable them), but the intended use is a
   * Moon-like world with `tectonics.oceanicFraction: 0`. */
  craters?: boolean;
  /** Volcano-adjacent lava lakes. Requires `volcanoes: true` — ignored otherwise. */
  lava?: boolean;
  seed?: number;
}

export interface IFeatureInstance {
  kind: 'volcano' | 'mesa' | 'crater';
  siteCellId: number;
  /** Unitless elevation delta this instance adds to its one site cell. Positive for volcano/mesa
   * (a rise), negative for crater (a dip) — see `computeFeatures()`'s doc comment for why this is
   * a flat per-cell stamp rather than a sampled shape. */
  elevationDelta: number;
}

export interface IPlanetFeatures {
  /** Dominant feature per cell, parallel to `graph.cells`. */
  feature: Feature[];
  instances: IFeatureInstance[];
  /** One entry per instance, keyed by its (single) site cell id. */
  featureByCellId: Map<number, IFeatureInstance>;
}

const DEFAULTS = {
  /** Target instance count scales with cell count (denser graphs get proportionally more
   * features), clamped to a sane range for a spike — not meant to be a tuned final density. */
  volcanoCellsPerInstance: 150,
  mesaCellsPerInstance: 120,
  craterCellsPerInstance: 40,
  maxVolcanoes: 12,
  maxMesas: 14,
  maxCraters: 40,
  /** Minimum hop spacing between two instances' sites. Each instance now only ever touches its
   * own single site cell (see the module doc comment below), so this is purely about not
   * clustering features on top of each other, not about footprint overlap. */
  minSpacingHops: 5,
  lavaLakeSearchHops: 2,
};

/** Converts the geological-shapes sampler's own tuned magnitudes (e.g. a volcano's default
 * `height: 48`) into the cell-planet's unitless elevation scale (tectonics elevation sits
 * roughly in -1..1.5, see `elevation.ts`'s `DEFAULTS`) — a single spike-tunable constant, not a
 * physical unit conversion. */
const ELEVATION_PER_SAMPLER_UNIT = 1 / 70;

/**
 * M-spike: assigns a discrete per-cell `Feature` and a flat cell-level elevation stamp to exactly
 * one site cell per instance — no neighbor spillover in the cell data. The detailed surface
 * sampler may turn a volcano instance into a bounded analytic cone/crater relief inside that
 * owning cell; `buildFeatureElevation()` remains the flat cell-resolution fallback for consumers
 * that only operate on per-cell elevation arrays.
 *
 * ## Why a flat single-cell stamp, not a sampled multi-cell shape
 *
 * An earlier version of this spike stamped every cell within 1-2 hops of the site using the
 * `geological-shapes.ts` analytic height functions (real cone+rim+crater etc.), so a volcano
 * rendered as an actual shaped landform spanning ~7-19 cells. Bruno's explicit ask from the start
 * was that a single cell *is* the discrete terrain unit — "a whole mesa, volcano, or crater," not
 * an area of cells around one. A ~19-cell blob contradicted that directly. This version trades
 * the smooth geological shape for that: each instance stamps only its own site cell, with a flat
 * elevation delta representative of the feature kind (volcano/mesa: a rise sized off that
 * sampler's tuned `height`; crater: a dip sized off its tuned `depth`) rather than a spatially
 * sampled height field. `cellCornerElevation()`'s existing 3-cell corner average still blends the
 * one stamped cell against its unstamped neighbors at shared vertices, so the transition isn't a
 * hard cliff even though the underlying data is a single flat value.
 *
 * ## Candidate selection
 *
 * Follows the existing precedent in `rivers.ts` (seeded shuffle, slice, spacing check against
 * already-picked sites) rather than a new pattern. Volcanoes favor land cells near a convergent/
 * subduction plate boundary; mesas favor elevated, low-slope land with a steep drop somewhere on
 * their border; craters (any profile, intended for Moon-like worlds) are a pure seeded scatter
 * with no tectonic correlation, since impacts aren't geology-driven.
 *
 * ## Lava lakes are a different mechanism from a planet-scale molten ocean
 *
 * A `'lava_lake'` tag is applied post hoc to an existing `waterBodyKind === 'lake'` cell within
 * `lavaLakeSearchHops` of a volcano instance's site — small, local, coexists with an ordinary
 * water ocean elsewhere on the same planet. A *planet-scale* molten world (Bruno's "recently-
 * formed planet" case) is not built here at all — it's `WorldProfile.oceanSubstance: 'lava'`
 * (`world-profile.ts`), which substance-flags the entire `waterBodyKind === 'ocean'` component
 * unconditionally, no volcano-adjacency or `Feature` instance involved.
 */
export function computeFeatures(
  graph: IPlanetGraphCore,
  tectonics: IPlanetTectonics,
  waterBodyKind: (WaterBodyKind | null)[],
  params: IFeatureParams,
): IPlanetFeatures {
  const rng = createSeededRandom((params.seed ?? tectonics.seed) + 907);
  const cellCount = graph.cells.length;
  const feature: Feature[] = new Array(cellCount).fill('none');
  const instances: IFeatureInstance[] = [];
  const featureByCellId = new Map<number, IFeatureInstance>();
  const chosenSites: number[] = [];

  const landElevations = tectonics.elevation.filter((_, id) => tectonics.isLand[id]);
  const maxLandElevation =
    landElevations.length > 0 ? Math.max(...landElevations) : tectonics.seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - tectonics.seaLevelElevation);
  const normalizedElevation = (id: number): number =>
    Math.max(0, tectonics.elevation[id] - tectonics.seaLevelElevation) / landRelief;

  const farEnoughFromChosen = (cellId: number): boolean => {
    for (const chosen of chosenSites) {
      if (cellsWithinHops(graph, chosen, DEFAULTS.minSpacingHops).has(cellId)) return false;
    }
    return true;
  };

  const shuffle = <T>(items: T[]): T[] => {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const placeInstance = (siteCellId: number, kind: 'volcano' | 'mesa' | 'crater', elevationDelta: number): void => {
    const instance: IFeatureInstance = { kind, siteCellId, elevationDelta };
    instances.push(instance);
    chosenSites.push(siteCellId);
    feature[siteCellId] = kind;
    featureByCellId.set(siteCellId, instance);
  };

  const defaults = defaultGeologicalTerrainSettings();
  const volcanoDelta = defaults.volcano.height * ELEVATION_PER_SAMPLER_UNIT;
  const mesaDelta = defaults.mesa.height * ELEVATION_PER_SAMPLER_UNIT;
  const craterDelta = -defaults.crater.depth * ELEVATION_PER_SAMPLER_UNIT;

  if (params.volcanoes) {
    const subductionCells = new Set<number>();
    for (const edge of tectonics.boundaries) {
      if (edge.type === 'convergent') {
        subductionCells.add(edge.cellA);
        subductionCells.add(edge.cellB);
      }
    }
    const ridgeSet = new Set(tectonics.ridgeCellIds);
    const candidates = graph.cells
      .filter(
        (cell) =>
          tectonics.isLand[cell.id] &&
          (ridgeSet.has(cell.id) || subductionCells.has(cell.id)) &&
          normalizedElevation(cell.id) > 0.3,
      )
      .map((cell) => cell.id);

    const target = Math.max(1, Math.min(DEFAULTS.maxVolcanoes, Math.round(cellCount / DEFAULTS.volcanoCellsPerInstance)));
    let placed = 0;
    for (const cellId of shuffle(candidates)) {
      if (placed >= target) break;
      if (!farEnoughFromChosen(cellId)) continue;
      placeInstance(cellId, 'volcano', volcanoDelta);
      placed++;
    }
  }

  if (params.mesas) {
    const candidates = graph.cells
      .filter((cell) => {
        if (!tectonics.isLand[cell.id] || feature[cell.id] !== 'none') return false;
        const ne = normalizedElevation(cell.id);
        if (ne < 0.3 || ne > 0.8) return false;
        let steepDrop = false;
        for (const neighborId of cell.neighbors) {
          if (tectonics.elevation[cell.id] - tectonics.elevation[neighborId] > landRelief * 0.15) {
            steepDrop = true;
            break;
          }
        }
        return steepDrop;
      })
      .map((cell) => cell.id);

    const target = Math.max(1, Math.min(DEFAULTS.maxMesas, Math.round(cellCount / DEFAULTS.mesaCellsPerInstance)));
    let placed = 0;
    for (const cellId of shuffle(candidates)) {
      if (placed >= target) break;
      if (!farEnoughFromChosen(cellId) || feature[cellId] !== 'none') continue;
      placeInstance(cellId, 'mesa', mesaDelta);
      placed++;
    }
  }

  if (params.craters) {
    const candidates = graph.cells.filter((cell) => feature[cell.id] === 'none').map((cell) => cell.id);
    const target = Math.max(1, Math.min(DEFAULTS.maxCraters, Math.round(cellCount / DEFAULTS.craterCellsPerInstance)));
    let placed = 0;
    for (const cellId of shuffle(candidates)) {
      if (placed >= target) break;
      if (!farEnoughFromChosen(cellId) || feature[cellId] !== 'none') continue;
      placeInstance(cellId, 'crater', craterDelta);
      placed++;
    }
  }

  if (params.lava && params.volcanoes) {
    for (const instance of instances) {
      if (instance.kind !== 'volcano') continue;
      for (const cellId of cellsWithinHops(graph, instance.siteCellId, DEFAULTS.lavaLakeSearchHops)) {
        if (waterBodyKind[cellId] === 'lake') feature[cellId] = 'lava_lake';
      }
    }
  }

  return { feature, instances, featureByCellId };
}

/**
 * Materializes a fresh per-cell elevation array with every feature instance's flat single-cell
 * stamp applied — same "copy once, overwrite touched indices, return `base` unchanged when
 * there's nothing to apply" shape as `terrain-edits.ts`'s `buildEffectiveElevation()`, which this
 * is meant to compose with the same way (call this first, then `buildEffectiveElevation()` on its
 * result, so a player's M4e edit always wins over generated feature terrain).
 */
export function buildFeatureElevation(base: number[], features: IPlanetFeatures): number[] {
  if (features.featureByCellId.size === 0) return base;
  const result = base.slice();
  for (const [cellId, instance] of features.featureByCellId) {
    result[cellId] = base[cellId] + instance.elevationDelta;
  }
  return result;
}
