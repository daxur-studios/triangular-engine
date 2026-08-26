import { buildCornerGraph } from './corner-graph';
import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { IVec3 } from './vec3';

export interface IRiverParams {
  seed?: number;
  sourceCount?: number;
  minSourceMoisture?: number;
  /** Fraction of land relief (seaLevel..maxLandElevation) a source corner must sit above. */
  minSourceElevationFraction?: number;
}

export interface IPlanetRivers {
  /** Ordered corner-point chains, each a downhill walk along cell edges from an inland source to its terminus. */
  riverPaths: IVec3[][];
  /** Corner positions that are land-locked local elevation minima — a river terminating here is a lake outlet. */
  lakeCorners: IVec3[];
}

const DEFAULTS = {
  sourceCount: 12,
  minSourceMoisture: 0.4,
  minSourceElevationFraction: 0.25,
};

/**
 * M2 river pass: picks high-moisture, high-elevation land corners as sources
 * and walks strictly downhill along the corner graph (see `corner-graph.ts`)
 * — i.e. along cell polygon edges, not cell-center to cell-center — until
 * reaching a corner that touches water (a coastline vertex, so the river
 * mouth lands exactly on the coast) or a local elevation minimum (a lake).
 * Corner elevation/moisture are the average of the 3 cells meeting there.
 * Elevation strictly decreases every step, so on this finite graph every
 * walk is guaranteed to terminate — no cycles are possible.
 *
 * Routing along cell edges instead of cell centers avoids two problems the
 * cell-center walk had: paths cutting straight through a coastal cell like a
 * canal instead of stopping at the coast, and paths reading as arbitrary
 * straight chords since a "step" wasn't tied to any boundary geometry.
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

  const corners = buildCornerGraph(graph);
  const cornerElevation = corners.cellIds.map(([a, b, c]) => (elevation[a] + elevation[b] + elevation[c]) / 3);
  const cornerMoisture = corners.cellIds.map(([a, b, c]) => (moisture[a] + moisture[b] + moisture[c]) / 3);
  const cornerIsLand = corners.cellIds.map(([a, b, c]) => isLand[a] && isLand[b] && isLand[c]);

  const candidates: number[] = [];
  for (let i = 0; i < corners.count; i++) {
    if (cornerIsLand[i] && cornerMoisture[i] >= p.minSourceMoisture && cornerElevation[i] >= minSourceElevation) {
      candidates.push(i);
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sources = candidates.slice(0, Math.min(p.sourceCount, candidates.length));

  const lakeCorners: IVec3[] = [];
  const riverPaths: IVec3[][] = [];

  for (const sourceIndex of sources) {
    let current = sourceIndex;
    const path: IVec3[] = [corners.position[current]];

    while (cornerIsLand[current]) {
      let lowest = -1;
      let lowestElevation = cornerElevation[current];
      for (const neighborIndex of corners.neighbors[current]) {
        if (cornerElevation[neighborIndex] < lowestElevation) {
          lowestElevation = cornerElevation[neighborIndex];
          lowest = neighborIndex;
        }
      }

      if (lowest === -1) {
        lakeCorners.push(corners.position[current]);
        break;
      }

      current = lowest;
      path.push(corners.position[current]);
    }

    riverPaths.push(path);
  }

  return { riverPaths, lakeCorners };
}
