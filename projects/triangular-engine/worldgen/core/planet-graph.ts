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

export function buildPlanetGraphCore(params: IPlanetGraphCoreParams): IPlanetGraphCore {
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
