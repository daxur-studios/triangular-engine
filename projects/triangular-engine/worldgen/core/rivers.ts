import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';

export interface IRiverParams {
  seed?: number;
  sourceCount?: number;
  minSourceMoisture?: number;
  /** Fraction of land relief (seaLevel..maxLandElevation) a source cell must sit above. */
  minSourceElevationFraction?: number;
}

export interface IPlanetRivers {
  /** Ordered cell-id chains, each a downhill walk from a source cell to its terminus. */
  riverPaths: number[][];
  /** Land cell ids that are local elevation minima — a river terminating here is a lake outlet. */
  lakeCellIds: number[];
}

const DEFAULTS = {
  sourceCount: 12,
  minSourceMoisture: 0.4,
  minSourceElevationFraction: 0.25,
};

/**
 * M2 river pass: picks high-moisture, high-elevation land cells as sources
 * and walks strictly downhill, one cell-adjacency step at a time, until
 * reaching the ocean or a local elevation minimum (a lake). Elevation
 * strictly decreases every step, so on this finite graph every walk is
 * guaranteed to terminate — no cycles are possible.
 *
 * The source elevation cutoff is a fraction of land relief
 * (`seaLevelElevation` .. max land elevation), not an absolute value, since
 * tectonics elevation is an arbitrary unitless scale. See runbook 022.
 */
export function traceRivers(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  seaLevelElevation: number,
  moisture: number[],
  params: IRiverParams = {},
): IPlanetRivers {
  const p = { ...DEFAULTS, ...params };
  const rng = createSeededRandom(params.seed ?? 0);

  const landElevations = elevation.filter((_, id) => isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - seaLevelElevation);
  const minSourceElevation = seaLevelElevation + p.minSourceElevationFraction * landRelief;

  const candidates = graph.cells
    .filter(
      (cell) =>
        isLand[cell.id] && moisture[cell.id] >= p.minSourceMoisture && elevation[cell.id] >= minSourceElevation,
    )
    .map((cell) => cell.id);

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sources = candidates.slice(0, Math.min(p.sourceCount, candidates.length));

  const lakeCellIds = new Set<number>();
  const riverPaths: number[][] = [];

  for (const sourceId of sources) {
    const path = [sourceId];
    let current = sourceId;

    while (isLand[current]) {
      let lowest = -1;
      let lowestElevation = elevation[current];
      for (const neighborId of graph.cells[current].neighbors) {
        if (elevation[neighborId] < lowestElevation) {
          lowestElevation = elevation[neighborId];
          lowest = neighborId;
        }
      }

      if (lowest === -1) {
        lakeCellIds.add(current);
        break;
      }

      current = lowest;
      path.push(current);
    }

    riverPaths.push(path);
  }

  return { riverPaths, lakeCellIds: [...lakeCellIds] };
}
