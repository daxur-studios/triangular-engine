import { type ICellPlanetWorld } from 'triangular-engine/worldgen';
import { angleBetween, validateShapeOp, type ShapeOp, type V3 } from '../shape-ops/shape-op';
import { isMountainCell } from './cell-bake';

/**
 * Plan 055 Phase 1b: per-game shape programs. A program turns a cell planet (and a seed) into engine shape ops, so
 * landforms the cells imply (mountains, ridges) are built only from ops that already have a TSL twin and parity specs.
 * A game writes its own programs; these two are examples. Programs are pure and deterministic, and every op they
 * return passes `validateShapeOp`.
 */

export type ShapeProgram = (world: ICellPlanetWorld, seed: number, options: ShapeProgramOptions) => ShapeOp[];

export interface ShapeProgramOptions {
  /** Body radius in metres: positions are body-relative metres. */
  readonly radiusM: number;
  /** Peak height of a mountain, metres (each gets 70 % to 100 % of it). Default 1500. */
  readonly mountainHeightM?: number;
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Vec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function metres(d: Vec, radiusM: number): V3 {
  return [d.x * radiusM, d.y * radiusM, d.z * radiusM];
}

const unit = (d: Vec): V3 => [d.x, d.y, d.z];

/** Angular distance from a cell's centre to its farthest corner. */
function cellAngle(world: ICellPlanetWorld, cellId: number): number {
  const cell = world.graph.cells[cellId];
  return Math.max(...cell.corners.map((corner) => angleBetween(unit(cell.center), unit(corner))));
}

function finish(ops: ShapeOp[]): ShapeOp[] {
  ops.forEach(validateShapeOp);
  return ops;
}

/** (a) Single-cell mountain: one cone per mountain cell, filling most of the cell. */
export const singleCellMountains: ShapeProgram = (world, seed, options) => {
  const random = rng(seed ^ 0x51ed);
  const peakM = options.mountainHeightM ?? 1500;
  const ops: ShapeOp[] = [];
  for (const cell of world.graph.cells) {
    if (!isMountainCell(world, cell.id)) continue;
    const radiusM = cellAngle(world, cell.id) * options.radiusM * 0.85;
    ops.push({
      id: `mountain-${cell.id}`,
      shape: {
        kind: 'cone',
        centre: metres(cell.center, options.radiusM),
        radiusM,
        heightM: peakM * (0.7 + 0.3 * random()),
        edgeM: radiusM * 0.15,
        sharpness: 1.3,
      },
      blend: { mode: 'add' },
      fidelity: 'silhouette',
    });
  }
  return finish(ops);
};

/** Corners shared by two cells, as a key for chaining (corners are the same object values from either cell). */
const cornerKey = (c: Vec): string => `${c.x.toFixed(9)},${c.y.toFixed(9)},${c.z.toFixed(9)}`;

/**
 * (b) Multi-cell ridge: the shared edges between neighbouring mountain cells are chained into polylines, and each
 * chain of at least two edges becomes one rounded path (a ridge line). Where a ridge ends over a plain, a flat disc
 * pads its foot; the highest point of a long ridge gets a summit crater.
 */
export const multiCellRidges: ShapeProgram = (world, seed, options) => {
  const random = rng(seed ^ 0x7a11);
  const peakM = options.mountainHeightM ?? 1500;
  const cells = world.graph.cells;
  const vertices = new Map<string, Vec>();
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };
  for (const cell of cells) {
    if (!isMountainCell(world, cell.id)) continue;
    const m = cell.neighbors.length;
    cell.neighbors.forEach((neighbour, k) => {
      if (neighbour < cell.id || !isMountainCell(world, neighbour)) return;
      // corners[k] sits between neighbors[k] and neighbors[k+1], so the edge shared with neighbors[k] is corners[k-1]..corners[k].
      const a = cell.corners[(k + m - 1) % m];
      const b = cell.corners[k];
      vertices.set(cornerKey(a), a);
      vertices.set(cornerKey(b), b);
      link(cornerKey(a), cornerKey(b));
    });
  }
  // Walk unused edges into chains, starting from chain ends (degree 1) first so a line is not split in the middle.
  const used = new Set<string>();
  const edgeId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const chains: string[][] = [];
  const order = [...edges.keys()].sort((p, q) => edges.get(p)!.size - edges.get(q)!.size || (p < q ? -1 : 1));
  for (const start of order) {
    for (;;) {
      const first = [...edges.get(start)!].sort().find((next) => !used.has(edgeId(start, next)));
      if (first === undefined) break;
      const chain = [start];
      let at = start;
      let next: string | undefined = first;
      while (next !== undefined) {
        used.add(edgeId(at, next));
        chain.push(next);
        at = next;
        next = [...edges.get(at)!].sort().find((n) => !used.has(edgeId(at, n)));
      }
      chains.push(chain);
    }
  }
  const ops: ShapeOp[] = [];
  chains.forEach((chain, n) => {
    if (chain.length < 3) return;
    const points = chain.map((key) => metres(vertices.get(key)!, options.radiusM));
    const heightsM = chain.map(() => peakM * (0.6 + 0.4 * random()));
    const widthM = peakM * 1.5;
    ops.push({
      id: `ridge-${n}`,
      shape: { kind: 'path', points, heightsM, widthM, edgeM: widthM * 0.25, profile: 'round' },
      blend: { mode: 'add' },
      fidelity: 'silhouette',
    });
    const top = heightsM.indexOf(Math.max(...heightsM));
    if (chain.length >= 5) {
      ops.push({
        id: `ridge-${n}-crater`,
        shape: {
          kind: 'crater', centre: points[top], radiusM: widthM * 0.45, depthM: peakM * 0.18,
          rimHeightM: peakM * 0.05, rimWidthM: widthM * 0.15, edgeM: widthM * 0.1,
        },
        blend: { mode: 'add' },
        fidelity: 'relaxed',
      });
    }
    for (const end of [0, points.length - 1]) {
      ops.push({
        id: `ridge-${n}-foot-${end === 0 ? 'a' : 'b'}`,
        shape: { kind: 'disc', centre: points[end], radiusM: widthM * 0.9, edgeM: widthM * 0.5 },
        blend: { mode: 'scale', factor: 0.5 },
        fidelity: 'relaxed',
      });
    }
  });
  return finish(ops);
};
