import { buildCornerGraph } from './corner-graph';
import { IPlanetGraphCore } from './planet-graph';
import { createSeededRandom } from './seeded-random';
import { add, IVec3, normalize, scale, sub } from './vec3';

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
  /**
   * Accumulated flow at each point of the matching `riverPaths` entry (same shape/length): how
   * many source paths pass through that point. Downhill stepping is deterministic — always the
   * single lowest neighbor — so once two rivers reach the same corner they follow an identical
   * path from there on, meaning flow only ever grows going downstream along any one path. Meant
   * for width-by-`sqrt(flow)` rendering (the Red Blob Games technique).
   */
  riverFlow: number[][];
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
 *
 * A corner counts as land here when its own blended elevation is >=
 * `seaLevelElevation` — the same per-vertex rule the 3D preview's terrain
 * color/height and its coastline overlay use (`resolveVertexColor()` /
 * `computeMeshWaterlineDirections()` in cell-planet-lab-page.component.ts),
 * not the coarser per-cell `isLand[]` flag. Using the coarse flag here used
 * to let a river's last corner land one edge short of (or past) the mesh's
 * true waterline, so the river visibly stopped short of the coast in some
 * cases. The final downhill step that crosses from land to water is also
 * clipped to the exact sea-level point on that edge (instead of ending on
 * the underwater corner), so the river mouth lands exactly on the same
 * boundary the coastline overlay draws.
 *
 * Flow accumulates as a side effect of the walk itself: every corner a
 * source's path touches increments that corner's running visit count, and
 * since two paths that converge on a corner are thereafter identical (the
 * downhill step is a pure function of the current corner), the count at any
 * corner is exactly how many sources' rivers are flowing through it — no
 * separate merge-detection pass needed. Sources are traced in two passes:
 * first to find every path's corner indices and finalize the flow counts,
 * then to read those counts back into each path's `riverFlow` entry, so a
 * source visited later in iteration order doesn't leave an earlier path's
 * recorded flow stale.
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
  const cornerIsLand = cornerElevation.map((e) => e >= seaLevelElevation);

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

  interface ISourceTrace {
    cornerIndices: number[];
    coastCrossing?: { from: number; to: number; t: number };
  }

  const cornerFlow = new Array<number>(corners.count).fill(0);
  const traces: ISourceTrace[] = [];
  const lakeCorners: IVec3[] = [];

  for (const sourceIndex of sources) {
    let current = sourceIndex;
    const cornerIndices: number[] = [current];
    cornerFlow[current]++;
    let coastCrossing: ISourceTrace['coastCrossing'];

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

      if (!cornerIsLand[lowest]) {
        // This step crosses the coast — end the path exactly on the sea-level
        // boundary instead of the underwater corner, so it meets the same
        // waterline the coastline overlay draws (see doc comment above).
        const eFrom = cornerElevation[current];
        const eTo = cornerElevation[lowest];
        const t = eFrom === eTo ? 0 : (seaLevelElevation - eFrom) / (eTo - eFrom);
        coastCrossing = { from: current, to: lowest, t };
        break;
      }

      current = lowest;
      cornerIndices.push(current);
      cornerFlow[current]++;
    }

    traces.push({ cornerIndices, coastCrossing });
  }

  const riverPaths: IVec3[][] = [];
  const riverFlow: number[][] = [];

  for (const trace of traces) {
    const path = trace.cornerIndices.map((index) => corners.position[index]);
    const flow = trace.cornerIndices.map((index) => cornerFlow[index]);

    if (trace.coastCrossing) {
      const { from, to, t } = trace.coastCrossing;
      const fromPos = corners.position[from];
      const toPos = corners.position[to];
      path.push(normalize(add(fromPos, scale(sub(toPos, fromPos), t))));
      flow.push(cornerFlow[from]);
    }

    riverPaths.push(path);
    riverFlow.push(flow);
  }

  return { riverPaths, lakeCorners, riverFlow };
}
