import { createPersistentCache } from 'triangular-engine/cache';
import { computeConvexHull3 } from './convex-hull3';
import { buildDualCells } from './dual-cells';
import { fibonacciSpherePoints } from './fibonacci-sphere';
import { relaxPointsOnSphere } from './lloyd-relaxation';
import { IVec3 } from './vec3';

export interface IPlanetGraphCell {
  id: number;
  /** Unit-sphere direction of the site (this cell's "center"). */
  center: IVec3;
  /** Cell polygon corners, unit-sphere directions, in cyclic (winding) order. */
  corners: IVec3[];
  /** Adjacent cell ids, same order/cardinality as `corners` (corners[k] sits between neighbors[k] and neighbors[k+1]). */
  neighbors: number[];
}

/**
 * M0 graph core: the cell/neighbor structure shared by every later worldgen
 * pass (plates, elevation, climate, biomes, rivers — see runbook 022). Pure
 * and deterministic: same params -> same graph, no Three.js/Angular coupling.
 */
export interface IPlanetGraphCore {
  seed: number;
  cells: IPlanetGraphCell[];
}

export interface IPlanetGraphCoreParams {
  /** Number of Voronoi cells (== seed points) to generate. */
  cellCount: number;
  seed?: number;
  /** Lloyd relaxation passes; 0 keeps the raw Fibonacci lattice. */
  relaxationIterations?: number;
  /** Per-point angular jitter (radians) applied before relaxation; defaults to a small seed-dependent amount so distinct seeds diverge before relaxation smooths them out. */
  jitter?: number;
}

const DEFAULT_RELAXATION_ITERATIONS = 2;

/**
 * Bump when the graph maths changes (points, relaxation, hull, dual cells), so graphs stored by an older
 * build are never read. Part of every cache key.
 */
const GRAPH_BUILD_VERSION = 1;

/** Built graphs, shared by every game on this origin through IndexedDB (a few hundred KB for 3000 cells). */
const graphCache = createPersistentCache<IPlanetGraphCore>({ namespace: 'planet-graph', maxEntries: 40 });

/** The cache key: the resolved recipe (defaults filled in) plus the build version. */
export function planetGraphCacheKey(params: IPlanetGraphCoreParams): string {
  const { cellCount, seed = 0, relaxationIterations = DEFAULT_RELAXATION_ITERATIONS } = params;
  const jitter = params.jitter ?? 0.15 / Math.sqrt(cellCount);
  return JSON.stringify([GRAPH_BUILD_VERSION, cellCount, seed, relaxationIterations, jitter]);
}

/**
 * Loads stored graphs for these recipes into memory, so the next `buildPlanetGraphCore` with the same
 * params returns at once instead of building (about 5 s for 3000 cells). Await it before the planet is built.
 * A recipe with nothing stored is built as before and stored afterwards.
 */
export function prewarmPlanetGraphs(recipes: readonly IPlanetGraphCoreParams[]): Promise<void> {
  return graphCache.preload(recipes.map(planetGraphCacheKey));
}

/** Builds a graph, reusing cached generation while giving each caller an independent mutable copy. */
export function buildPlanetGraphCore(params: IPlanetGraphCoreParams): IPlanetGraphCore {
  const key = planetGraphCacheKey(params);
  const stored = graphCache.get(key);
  if (stored) return structuredClone(stored);
  const graph = computePlanetGraphCore(params);
  graphCache.set(key, structuredClone(graph));
  return graph;
}

function computePlanetGraphCore(params: IPlanetGraphCoreParams): IPlanetGraphCore {
  const {
    cellCount,
    seed = 0,
    relaxationIterations = DEFAULT_RELAXATION_ITERATIONS,
    jitter = 0.15 / Math.sqrt(cellCount),
  } = params;

  const seedPoints = fibonacciSpherePoints({ count: cellCount, seed, jitter });
  const sites =
    relaxationIterations > 0 ? relaxPointsOnSphere(seedPoints, relaxationIterations) : seedPoints;

  const { faces } = computeConvexHull3(sites);
  const { neighborsByVertex, cornersByVertex } = buildDualCells(sites.length, faces);

  const cells: IPlanetGraphCell[] = sites.map((center, id) => ({
    id,
    center,
    corners: cornersByVertex[id],
    neighbors: neighborsByVertex[id],
  }));

  return { seed, cells };
}
