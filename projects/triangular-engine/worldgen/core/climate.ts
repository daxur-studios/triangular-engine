import { IPlanetGraphCore } from './planet-graph';

export interface IClimateParams {
  /** Elevation-per-unit temperature drop on land (mountains are colder). */
  lapseRate?: number;
  /** How many graph hops moisture spreads inland from the ocean before hitting zero. */
  moistureFalloffRadius?: number;
}

export interface IPlanetClimate {
  /** Per-cell temperature: ~1 (hot equator) down to ~-1 (frozen poles), before elevation chill. */
  temperature: number[];
  /** Per-cell moisture: 1 (ocean) decaying to 0 inland. */
  moisture: number[];
}

const DEFAULTS = {
  lapseRate: 0.6,
  moistureFalloffRadius: 4,
};

/**
 * M2 climate pass: temperature from latitude (guaranteeing cold poles/hot
 * equator by construction) minus an elevation lapse, and moisture as a
 * multi-source BFS distance-from-ocean field. See runbook 022.
 *
 * Tectonics elevation is an arbitrary unitless scale (boundary contributions
 * stack near dense plate boundaries, so its range varies a lot by params) —
 * the lapse term normalizes elevation against the actual land relief
 * (`seaLevelElevation` .. max land elevation) rather than assuming a fixed
 * absolute range.
 */
export function computeClimate(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  seaLevelElevation: number,
  params: IClimateParams = {},
): IPlanetClimate {
  const p = { ...DEFAULTS, ...params };
  const cellCount = graph.cells.length;

  const landElevations = elevation.filter((_, id) => isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - seaLevelElevation);

  const temperature = graph.cells.map((cell, id) => {
    // |y| is sin(latitude): 0 at the equator, 1 at the poles (see planet-graph's axis convention).
    const latitude = Math.abs(cell.center.y);
    const base = 1 - latitude * 2;
    const normalizedElevation = isLand[id] ? Math.max(0, elevation[id] - seaLevelElevation) / landRelief : 0;
    return base - normalizedElevation * p.lapseRate;
  });

  const moisture = new Array<number>(cellCount).fill(0);
  const visited = new Array<boolean>(cellCount).fill(false);
  let frontier: number[] = [];
  for (let id = 0; id < cellCount; id++) {
    if (!isLand[id]) {
      moisture[id] = 1;
      visited[id] = true;
      frontier.push(id);
    }
  }

  for (let hop = 1; hop <= p.moistureFalloffRadius && frontier.length > 0; hop++) {
    const value = Math.max(0, 1 - hop / p.moistureFalloffRadius);
    const next: number[] = [];
    for (const cellId of frontier) {
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (visited[neighborId]) continue;
        visited[neighborId] = true;
        moisture[neighborId] = value;
        next.push(neighborId);
      }
    }
    frontier = next;
  }

  return { temperature, moisture };
}
