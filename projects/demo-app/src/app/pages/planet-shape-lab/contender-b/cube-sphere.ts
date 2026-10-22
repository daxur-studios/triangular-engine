/**
 * Plan 055 contender B: the cube-sphere every patch lives on. Six faces, each a quadtree of leaves; a leaf at level `L` is
 * one of `2^L x 2^L` squares of its face, cut into `LEAF_CELLS` cells a side.
 *
 * Faces follow `shape-ops/op-index.ts`: face `f` has major axis `f >> 1`, sign `+` for even `f`, and its (u, v) axes are
 * the next two axes over. The mapping is equal-angle: a face coordinate `s` in [-1, 1] sits at `tan(s * pi / 4)` on the
 * cube, so cells are close to the same size over the whole face (gnomonic cells shrink to a fifth toward the corners).
 *
 * Shared vertices must be identical on both sides of every edge, also across cube edges. Every lattice point therefore
 * has a canonical key: integer cube coordinates on the finest lattice, the same from every face that owns the point, and
 * its direction is computed from the key alone (`latticeDirection`), with components on a cube edge exactly +-1.
 */

export type Vec3 = [number, number, number];

/** Cells along a leaf edge; a leaf has `(LEAF_CELLS + 1)^2` vertices. */
export const LEAF_CELLS = 32;

/** Deepest leaf level: on Earth a leaf is 2.4 m across and a cell 7 cm. */
export const MAX_LEVEL = 19;

/** Lattice points along a face edge at the finest level, minus one: face coordinate `s = 2 q / LATTICE - 1`. */
export const LATTICE = LEAF_CELLS * 2 ** MAX_LEVEL;

export interface LeafKey {
  readonly face: number;
  readonly level: number;
  /** Column (along u) and row (along v), each in [0, 2^level). */
  readonly i: number;
  readonly j: number;
}

export function leafId(leaf: LeafKey): string {
  return `${leaf.face}/${leaf.level}/${leaf.i}/${leaf.j}`;
}

export function faceAxes(face: number): { axis: number; sign: number; u: number; v: number } {
  const axis = face >> 1;
  return { axis, sign: face & 1 ? -1 : 1, u: (axis + 1) % 3, v: (axis + 2) % 3 };
}

/** The face a direction points through: its largest component. */
export function faceOf(direction: Readonly<Vec3>): number {
  const ax = Math.abs(direction[0]);
  const ay = Math.abs(direction[1]);
  const az = Math.abs(direction[2]);
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  return axis * 2 + (direction[axis] >= 0 ? 0 : 1);
}

const QUARTER_PI = Math.PI / 4;

/** Cube coordinate of face coordinate `s` (equal-angle); exactly +-1 at the face's edges. */
function cubeOf(s: number): number {
  return s === 1 ? 1 : s === -1 ? -1 : Math.tan(s * QUARTER_PI);
}

/** Unit direction of face coordinates (s, t) on `face`. */
export function faceDirection(face: number, s: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { axis, sign, u, v } = faceAxes(face);
  out[axis] = sign;
  out[u] = cubeOf(s);
  out[v] = cubeOf(t);
  const length = Math.hypot(out[0], out[1], out[2]);
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
  return out;
}

/** Face and face coordinates (s, t) in [-1, 1] of a direction (need not be unit). */
export function faceCoordinates(direction: Readonly<Vec3>): { face: number; s: number; t: number } {
  const face = faceOf(direction);
  const { axis, sign, u, v } = faceAxes(face);
  const major = direction[axis] * sign;
  return { face, s: Math.atan(direction[u] / major) / QUARTER_PI, t: Math.atan(direction[v] / major) / QUARTER_PI };
}

/** Lattice coordinate (in [0, LATTICE]) of vertex `a` along a leaf's column `i` at `level`. */
export function latticeCoordinate(level: number, i: number, a: number): number {
  return (i * LEAF_CELLS + a) * 2 ** (MAX_LEVEL - level);
}

/**
 * Canonical key of the lattice point (qu, qv) of `face`: its integer cube coordinates `2 q - LATTICE`, with the major
 * axis at `+-LATTICE`. A point on a cube edge or corner has the same key from every face that owns it.
 */
export function latticeKey(face: number, qu: number, qv: number): string {
  const { axis, sign, u, v } = faceAxes(face);
  const c = [0, 0, 0];
  c[axis] = sign * LATTICE;
  c[u] = 2 * qu - LATTICE;
  c[v] = 2 * qv - LATTICE;
  return `${c[0]},${c[1]},${c[2]}`;
}

/** Unit direction of the lattice point (qu, qv) of `face`; equal for every face that shares the point (see `latticeKey`). */
export function latticeDirection(face: number, qu: number, qv: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const { axis, sign, u, v } = faceAxes(face);
  // Through the key's integers, so a shared point computes the same numbers whichever face asks.
  const c: Vec3 = [0, 0, 0];
  c[axis] = sign * LATTICE;
  c[u] = 2 * qu - LATTICE;
  c[v] = 2 * qv - LATTICE;
  for (let k = 0; k < 3; k++) out[k] = cubeOf(c[k] / LATTICE);
  const length = Math.hypot(out[0], out[1], out[2]);
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
  return out;
}

/** Face coordinate range [s0, s1] of a leaf along one axis. */
export function leafRange(level: number, i: number): [number, number] {
  const size = 2 / 2 ** level;
  return [-1 + i * size, -1 + (i + 1) * size];
}

/** Unit direction of a leaf's centre. */
export function leafCentre(leaf: LeafKey, out: Vec3 = [0, 0, 0]): Vec3 {
  const [s0, s1] = leafRange(leaf.level, leaf.i);
  const [t0, t1] = leafRange(leaf.level, leaf.j);
  return faceDirection(leaf.face, (s0 + s1) / 2, (t0 + t1) / 2, out);
}

/** Largest angle (radians) from a leaf's centre to its corners: the cap that holds the leaf. */
export function leafAngularRadius(leaf: LeafKey): number {
  const centre = leafCentre(leaf);
  const [s0, s1] = leafRange(leaf.level, leaf.i);
  const [t0, t1] = leafRange(leaf.level, leaf.j);
  let largest = 0;
  const corner: Vec3 = [0, 0, 0];
  for (const s of [s0, s1]) {
    for (const t of [t0, t1]) {
      faceDirection(leaf.face, s, t, corner);
      const dot = Math.min(1, centre[0] * corner[0] + centre[1] * corner[1] + centre[2] * corner[2]);
      largest = Math.max(largest, Math.acos(dot));
    }
  }
  return largest;
}

/** The leaf at `level` that holds a direction. */
export function leafAt(direction: Readonly<Vec3>, level: number): LeafKey {
  const { face, s, t } = faceCoordinates(direction);
  const n = 2 ** level;
  const index = (x: number) => Math.min(n - 1, Math.max(0, Math.floor(((x + 1) / 2) * n)));
  return { face, level, i: index(s), j: index(t) };
}

/** The four children of a leaf, in (i, j) order: (0,0), (1,0), (0,1), (1,1). */
export function children(leaf: LeafKey): LeafKey[] {
  const level = leaf.level + 1;
  return [0, 1, 2, 3].map((k) => ({ face: leaf.face, level, i: leaf.i * 2 + (k & 1), j: leaf.j * 2 + (k >> 1) }));
}

/** Edges of a leaf: 0 is s = s0 (west), 1 is s = s1 (east), 2 is t = t0 (south), 3 is t = t1 (north). */
export type Edge = 0 | 1 | 2 | 3;

/**
 * Directions just outside a leaf across `edge`, at `count` evenly spaced points along it (inset from the corners): what
 * a neighbour lookup probes. Across a cube edge they land on the next face.
 */
export function beyondEdge(leaf: LeafKey, edge: Edge, count: number): Vec3[] {
  const [s0, s1] = leafRange(leaf.level, leaf.i);
  const [t0, t1] = leafRange(leaf.level, leaf.j);
  const step = (s1 - s0) * 1e-3;
  const { axis, sign, u, v } = faceAxes(leaf.face);
  const points: Vec3[] = [];
  for (let k = 0; k < count; k++) {
    const f = (k + 0.5) / count;
    const s = edge === 0 ? s0 - step : edge === 1 ? s1 + step : s0 + (s1 - s0) * f;
    const t = edge === 2 ? t0 - step : edge === 3 ? t1 + step : t0 + (t1 - t0) * f;
    // Past the face edge `s` leaves [-1, 1]; the cube point is still well defined (tan grows past 1), and a direction
    // through it belongs to the next face.
    const d: Vec3 = [0, 0, 0];
    d[axis] = sign;
    d[u] = Math.tan(s * QUARTER_PI);
    d[v] = Math.tan(t * QUARTER_PI);
    const length = Math.hypot(d[0], d[1], d[2]);
    points.push([d[0] / length, d[1] / length, d[2] / length]);
  }
  return points;
}
