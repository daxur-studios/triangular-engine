import { cellsWithinHops } from './terrain-edits';
import {
  CraterSettings,
  defaultGeologicalTerrainSettings,
  MesaSettings,
  sampleCrater,
  sampleMesa,
  sampleVolcano,
  VolcanoSettings,
} from './geological-shapes';
import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { IPlanetTectonics } from './tectonics';
import { WaterBodyKind } from './water-bodies';
import { cross, dot, IVec3, normalize, scale, sub, vec3 } from './vec3';

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

type IFeatureShapeInstance =
  | { kind: 'volcano'; settings: VolcanoSettings }
  | { kind: 'mesa'; settings: MesaSettings }
  | { kind: 'crater'; settings: CraterSettings };

export interface IFeatureInstance {
  kind: 'volcano' | 'mesa' | 'crater';
  siteCellId: number;
  siteDirection: IVec3;
  tangentU: IVec3;
  tangentV: IVec3;
  /** Cells within this instance's footprint (`cellsWithinHops()`), including the site itself. */
  footprintCellIds: number[];
  /** Maps a local tangent-plane angular offset (radians) into the geological sampler's own local
   * unit convention: `sampler_unit = angular_offset * mappingScale`. Chosen so the footprint's
   * own angular extent (the farthest footprint cell from the site) lands at the sampler's
   * default `radius` — see `computeFeatures()`'s doc comment. */
  mappingScale: number;
  settings: VolcanoSettings | MesaSettings | CraterSettings;
}

export interface IPlanetFeatures {
  /** Dominant feature per cell, parallel to `graph.cells`. */
  feature: Feature[];
  instances: IFeatureInstance[];
  /** Every footprint cell of every instance, for O(1) lookup — built from `footprintCellIds`. */
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
  volcanoFootprintHops: 2,
  mesaFootprintHops: 2,
  craterFootprintHops: 1,
  /** Minimum hop spacing between two instances' sites, kept comfortably larger than either's
   * footprint radius so footprints never overlap (`computeFeatures()` doesn't attempt to
   * compose overlapping stamps). */
  minSpacingHops: 5,
  lavaLakeSearchHops: 2,
};

/** Converts the geological-shapes sampler's own output scale (tuned for a local terrain
 * workbench, e.g. a volcano's default `height: 48`) into the cell-planet's unitless elevation
 * scale (tectonics elevation sits roughly in -1..1.5, see `elevation.ts`'s `DEFAULTS`) — a single
 * spike-tunable constant, not a physical unit conversion. */
const ELEVATION_PER_SAMPLER_UNIT = 1 / 70;

/**
 * M-spike: assigns a discrete per-cell `Feature` and, for shape-bearing kinds
 * (volcano/mesa/crater), a geological-shapes-driven elevation stamp — see
 * `worldgen/core/geological-shapes.ts` (the analytic volcano/crater/mesa height functions,
 * relocated from the `geological-features` demo lab, which already models cone+rim+crater,
 * bowl+rim+ejecta, and cap+talus+edge far better than a from-scratch flatten/dig would).
 *
 * ## Why this reads as a per-cell array rewrite, not a `sampleElevation()`-time hook
 *
 * The visual chunk mesh (`chunking.ts`) never actually calls `sampleElevation()` — it reads
 * `elevation[cell.id]` and `cellCornerElevation()` directly off whatever array it's handed, same
 * as `buildEffectiveElevation()` (the M4e terrain-edit layer) already relies on. So a feature's
 * shape only becomes visible in the mesh if it changes what's *in* that array, at every cell in
 * its footprint — not just its site cell. `buildFeatureElevation()` below does exactly that:
 * for every footprint cell, it samples the matching geological function at that cell's own
 * center direction (projected into the feature's local tangent plane) and writes the result in.
 * `cellCornerElevation()`'s existing 3-cell average then blends footprint cells against their
 * unstamped neighbors for free, giving a properly-shaped multi-cell cone/bowl/cap with no changes
 * to `chunking.ts`, `collider-patch.ts`, or `sample-elevation.ts` at all — every consumer already
 * reads whatever array it's given, exactly the property `buildEffectiveElevation()` depends on.
 *
 * ## Footprint and local-coordinate mapping
 *
 * A footprint is `cellsWithinHops()` (reused from `terrain-edits.ts`, same brush-shape helper
 * M4e's flatten/dig already uses) around the feature's site cell — hop count, not an angular
 * radius, so footprint size scales naturally with local cell density. The farthest footprint
 * cell's angular distance from the site becomes that instance's reference radius; sampling maps
 * a queried direction's tangent-plane angular offset into the geological sampler's own default
 * `radius` units by that ratio (`mappingScale`), so the sampler's tuned falloff (rim position,
 * crater bowl width, etc, all expressed relative to its own `radius`) lines up with the actual
 * footprint regardless of what that footprint's real angular size happens to be.
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
 * `lavaLakeSearchHops` of a volcano instance — small, local, coexists with an ordinary water
 * ocean elsewhere on the same planet. A *planet-scale* molten world (Bruno's "recently-formed
 * planet" case) is not built here at all — it's `WorldProfile.oceanSubstance: 'lava'`
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

  const placeInstance = (
    siteCellId: number,
    footprintHops: number,
    shape: IFeatureShapeInstance,
  ): void => {
    const site = graph.cells[siteCellId].center;
    const arbitrary = Math.abs(site.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    const tangentU = normalize(cross(arbitrary, site));
    const tangentV = cross(site, tangentU);

    const footprintCellIds = [...cellsWithinHops(graph, siteCellId, footprintHops)];
    let angularRadius = 1e-4;
    for (const id of footprintCellIds) {
      const d = Math.min(1, Math.max(-1, dot(site, graph.cells[id].center)));
      angularRadius = Math.max(angularRadius, Math.acos(d));
    }

    const instance: IFeatureInstance = {
      kind: shape.kind,
      siteCellId,
      siteDirection: site,
      tangentU,
      tangentV,
      footprintCellIds,
      mappingScale: shape.settings.radius / angularRadius,
      settings: shape.settings,
    };

    instances.push(instance);
    chosenSites.push(siteCellId);
    for (const cellId of footprintCellIds) {
      feature[cellId] = shape.kind;
      featureByCellId.set(cellId, instance);
    }
  };

  const defaults = defaultGeologicalTerrainSettings();

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
      placeInstance(cellId, DEFAULTS.volcanoFootprintHops, {
        kind: 'volcano',
        settings: { ...defaults.volcano, seed: Math.floor(rng() * 100000) },
      });
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
      placeInstance(cellId, DEFAULTS.mesaFootprintHops, {
        kind: 'mesa',
        settings: { ...defaults.mesa, seed: Math.floor(rng() * 100000) },
      });
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
      placeInstance(cellId, DEFAULTS.craterFootprintHops, {
        kind: 'crater',
        settings: { ...defaults.crater, seed: Math.floor(rng() * 100000) },
      });
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

/** Projects `direction` onto `instance`'s local tangent plane (gnomonic/central projection —
 * the same construction `buildColliderPatch()` uses in reverse), scaled into the geological
 * sampler's own local unit convention via `mappingScale`. Returns `null` when `direction` is
 * behind the site's local horizon (shouldn't happen for footprint cells in practice, but this
 * function is also safe to call with an arbitrary direction). */
function localSampleCoordinates(instance: IFeatureInstance, direction: IVec3): { x: number; z: number } | null {
  const d = dot(direction, instance.siteDirection);
  if (d <= 1e-6) return null;
  const projected = scale(direction, 1 / d);
  const offset = sub(projected, instance.siteDirection);
  return {
    x: dot(offset, instance.tangentU) * instance.mappingScale,
    z: dot(offset, instance.tangentV) * instance.mappingScale,
  };
}

/** Unitless elevation contribution of `instance` at `direction` — 0 outside its practical
 * falloff, since every geological-shapes sampler decays to ~0 well before its own `radius`. */
export function sampleFeatureElevation(instance: IFeatureInstance, direction: IVec3): number {
  const local = localSampleCoordinates(instance, direction);
  if (!local) return 0;
  const raw =
    instance.kind === 'volcano'
      ? sampleVolcano(local.x, local.z, instance.settings as VolcanoSettings)
      : instance.kind === 'mesa'
        ? sampleMesa(local.x, local.z, instance.settings as MesaSettings)
        : sampleCrater(local.x, local.z, instance.settings as CraterSettings);
  return raw * ELEVATION_PER_SAMPLER_UNIT;
}

/**
 * Materializes a fresh per-cell elevation array with every feature instance's shape stamped in —
 * same "copy once, overwrite touched indices, return `base` unchanged when there's nothing to
 * apply" shape as `terrain-edits.ts`'s `buildEffectiveElevation()`, which this is meant to
 * compose with the same way (call this first, then `buildEffectiveElevation()` on its result, so
 * a player's M4e edit always wins over generated feature terrain).
 */
export function buildFeatureElevation(base: number[], graph: IPlanetGraphCore, features: IPlanetFeatures): number[] {
  if (features.featureByCellId.size === 0) return base;
  const result = base.slice();
  for (const [cellId, instance] of features.featureByCellId) {
    result[cellId] = base[cellId] + sampleFeatureElevation(instance, graph.cells[cellId].center);
  }
  return result;
}
