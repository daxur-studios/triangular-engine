import { PLANE_FRAME, faceOfDirection, type CubeWarp, type DomainKind, type Vec3 } from './lod-domain';
import { MAX_LATTICE_STEPS, cubeComponent, cubeLattice } from './lod-lattice';

/**
 * Plan 059 step 2: the pure half of the baked texture height source (no three.js, no worker, so specs call it directly).
 *
 * A face (or the plane) is sampled on (2^k + 1)^2 texels whose centres sit exactly on lattice points of the lab's integer
 * lattice (`lod-lattice.ts`, L = 2^24 steps per side): texel i is lattice coordinate i * 2^(24 - k), an integer. The
 * sampler is called with the base-surface position (domain frame, doubles), which for the sphere is computed from the
 * cube-lattice vector T of the texel, not from (face, u, v): T is a property of the point, so a texel on a face edge or
 * corner gets the same position, and the same value, from every face that has it (canonical edges). A pyramid of height
 * ranges over the texel cells serves the selector's per-node bounds.
 */

/** Height of the base surface at a position in the domain frame (doubles), metres. */
export type HeightSampler = (x: number, y: number, z: number) => number;

export interface BakeLayout {
  readonly kind: DomainKind;
  readonly warp: CubeWarp;
  /** Plane: side of the square. Sphere: radius. Metres. */
  readonly sizeM: number;
  /** Texel cells per face side are 2^k; the texture is (2^k + 1) texels wide. */
  readonly k: number;
}

/** 1025 x 1025 texels per face. */
export const DEFAULT_BAKE_K = 10;
export const MIN_BAKE_K = 2;
export const MAX_BAKE_K = 12;

/** Min and max of the heights over the texel cells of every face, coarser levels by 2 x 2 reduction. */
export interface HeightPyramid {
  /** Level 0 cells per face side (2^k); level l has `cells >> l`. */
  readonly cells: number;
  /** Per level, `faces * c * c` entries, index `face * c * c + j * c + i`. Padded outward by float32 rounding slack. */
  readonly min: readonly Float32Array[];
  readonly max: readonly Float32Array[];
}

export interface BakedHeights {
  readonly layout: BakeLayout;
  /** Texels per side, 2^k + 1. */
  readonly side: number;
  readonly faces: number;
  /** All faces, `faces * side * side`, face-major then row-major (index `face * side * side + j * side + i`). */
  readonly texels: Float32Array;
  readonly pyramid: HeightPyramid;
  /** Extremes over all texels. */
  readonly minM: number;
  readonly maxM: number;
  /** Largest absolute height of the surface anywhere (bilinear never exceeds its texels). */
  readonly boundM: number;
  /** Sampling time per face, ms. */
  readonly bakeMsPerFace: readonly number[];
  /** Pyramid build time, ms. */
  readonly pyramidMs: number;
}

export function bakeFaces(kind: DomainKind): number {
  return kind === 'plane' ? 1 : 6;
}

export const bakeSide = (k: number): number => 2 ** k + 1;

/** Lattice steps per texel cell: texel i is lattice coordinate i * this. */
export const texelLattice = (k: number): number => MAX_LATTICE_STEPS / 2 ** k;

/** Cube coordinate of T = (index - 2^k) * step, per cube-lattice index; one table per (k, warp), shared by every texel. */
const componentTables = new Map<string, Float64Array>();
// The last table used, so a bake (one layout for millions of texels) neither builds a key nor looks one up per texel.
let lastTable: { k: number; warp: CubeWarp; table: Float64Array } | undefined;
function componentTable(k: number, warp: CubeWarp): Float64Array {
  if (lastTable && lastTable.k === k && lastTable.warp === warp) return lastTable.table;
  const key = `${k}|${warp}`;
  let table = componentTables.get(key);
  if (!table) {
    const step = texelLattice(k);
    table = new Float64Array(2 * 2 ** k + 1);
    for (let n = 0; n < table.length; n++) table[n] = cubeComponent((n - 2 ** k) * step, MAX_LATTICE_STEPS, warp);
    componentTables.set(key, table);
  }
  lastTable = { k, warp, table };
  return table;
}

/**
 * Base-surface position of texel (i, j) of a face. Sphere: from the integer cube-lattice vector, so shared edge and
 * corner texels of different faces get bit-identical positions.
 */
export function texelPoint(layout: BakeLayout, face: number, i: number, j: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const step = texelLattice(layout.k);
  const u = i * step;
  const v = j * step;
  if (layout.kind === 'plane') {
    const x = (u / MAX_LATTICE_STEPS - 0.5) * layout.sizeM;
    const y = (v / MAX_LATTICE_STEPS - 0.5) * layout.sizeM;
    const { u: au, v: av } = PLANE_FRAME;
    for (let a = 0; a < 3; a++) out[a] = x * au[a] + y * av[a];
    return out;
  }
  cubeLattice(face, u, v, MAX_LATTICE_STEPS, out);
  // T is a multiple of the texel step, so each component is a table entry: the same `cubeComponent` values, computed once.
  const table = componentTable(layout.k, layout.warp);
  const cells = 2 ** layout.k;
  const cx = table[(out[0] / step + cells) | 0];
  const cy = table[(out[1] / step + cells) | 0];
  const cz = table[(out[2] / step + cells) | 0];
  const scale = layout.sizeM / Math.sqrt(cx * cx + cy * cy + cz * cz);
  out[0] = cx * scale;
  out[1] = cy * scale;
  out[2] = cz * scale;
  return out;
}

/**
 * Base-surface position of a face lattice point (u, v) that need not be a texel centre (the probes use this). The same
 * arithmetic as {@link texelPoint}, so at a texel centre the two agree bit for bit.
 */
export function latticePoint(layout: BakeLayout, face: number, u: number, v: number, out: Vec3 = [0, 0, 0]): Vec3 {
  if (layout.kind === 'plane') {
    const x = (u / MAX_LATTICE_STEPS - 0.5) * layout.sizeM;
    const y = (v / MAX_LATTICE_STEPS - 0.5) * layout.sizeM;
    const { u: au, v: av } = PLANE_FRAME;
    for (let a = 0; a < 3; a++) out[a] = x * au[a] + y * av[a];
    return out;
  }
  cubeLattice(face, u, v, MAX_LATTICE_STEPS, out);
  const cx = cubeComponent(out[0], MAX_LATTICE_STEPS, layout.warp);
  const cy = cubeComponent(out[1], MAX_LATTICE_STEPS, layout.warp);
  const cz = cubeComponent(out[2], MAX_LATTICE_STEPS, layout.warp);
  const scale = layout.sizeM / Math.sqrt(cx * cx + cy * cy + cz * cz);
  out[0] = cx * scale;
  out[1] = cy * scale;
  out[2] = cz * scale;
  return out;
}

/** Face and continuous lattice coordinates (0..L) of a base-surface position; the inverse of {@link texelPoint}'s mapping. */
export function latticeOfPosition(layout: BakeLayout, x: number, y: number, z: number, out: { face: number; u: number; v: number }): void {
  const clamp = (value: number) => Math.min(MAX_LATTICE_STEPS, Math.max(0, value));
  if (layout.kind === 'plane') {
    // PLANE_FRAME: u = +X, v = -Z.
    out.face = 0;
    out.u = clamp((x / layout.sizeM + 0.5) * MAX_LATTICE_STEPS);
    out.v = clamp((-z / layout.sizeM + 0.5) * MAX_LATTICE_STEPS);
    return;
  }
  const { face, s, t } = faceOfDirection(x, y, z);
  const param = (value: number) => (layout.warp === 'none' ? value : (4 / Math.PI) * Math.atan(value));
  out.face = face;
  out.u = clamp(((param(s) + 1) / 2) * MAX_LATTICE_STEPS);
  out.v = clamp(((param(t) + 1) / 2) * MAX_LATTICE_STEPS);
}

/** Relative and absolute slack that keeps a float32 bilinear result inside its texels' range. */
const PAD_RELATIVE = 1e-6;
const PAD_ABSOLUTE = 1e-6;

/** Builds the pyramid from the texel array: level 0 is the min and max of each cell's four corner texels. */
export function buildPyramid(texels: Float32Array, k: number, faces: number): HeightPyramid {
  const side = bakeSide(k);
  const cells = 2 ** k;
  const min: Float32Array[] = [];
  const max: Float32Array[] = [];
  const lo0 = new Float32Array(faces * cells * cells);
  const hi0 = new Float32Array(faces * cells * cells);
  for (let face = 0; face < faces; face++) {
    const base = face * side * side;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const o = base + j * side + i;
        const a = texels[o];
        const b = texels[o + 1];
        const c = texels[o + side];
        const d = texels[o + side + 1];
        const lo = a < b ? (c < d ? (a < c ? a : c) : (a < d ? a : d)) : (c < d ? (b < c ? b : c) : (b < d ? b : d));
        const hi = a > b ? (c > d ? (a > c ? a : c) : (a > d ? a : d)) : (c > d ? (b > c ? b : c) : (b > d ? b : d));
        const n = face * cells * cells + j * cells + i;
        lo0[n] = lo - (PAD_RELATIVE * Math.abs(lo) + PAD_ABSOLUTE);
        hi0[n] = hi + (PAD_RELATIVE * Math.abs(hi) + PAD_ABSOLUTE);
      }
    }
  }
  min.push(lo0);
  max.push(hi0);
  for (let c = cells >> 1; c >= 1; c >>= 1) {
    const lo = new Float32Array(faces * c * c);
    const hi = new Float32Array(faces * c * c);
    const pc = c * 2;
    const plo = min[min.length - 1];
    const phi = max[max.length - 1];
    for (let face = 0; face < faces; face++) {
      for (let j = 0; j < c; j++) {
        for (let i = 0; i < c; i++) {
          const p = face * pc * pc + 2 * j * pc + 2 * i;
          const n = face * c * c + j * c + i;
          lo[n] = Math.min(plo[p], plo[p + 1], plo[p + pc], plo[p + pc + 1]);
          hi[n] = Math.max(phi[p], phi[p + 1], phi[p + pc], phi[p + pc + 1]);
        }
      }
    }
    min.push(lo);
    max.push(hi);
  }
  return { cells, min, max };
}

/**
 * Height range of quadtree node (root, level, i, j): the pyramid cell it covers, or for a node smaller than a texel cell
 * the cell that contains it. Always contains every height the bilinear surface takes over the node.
 */
export function pyramidRange(pyramid: HeightPyramid, k: number, root: number, level: number, i: number, j: number, out: [number, number]): void {
  let l = 0;
  let ci = i;
  let cj = j;
  if (level <= k) l = k - level;
  else {
    const shift = level - k;
    ci = Math.floor(i / 2 ** shift);
    cj = Math.floor(j / 2 ** shift);
  }
  const c = pyramid.cells >> l;
  const n = root * c * c + cj * c + ci;
  out[0] = pyramid.min[l][n];
  out[1] = pyramid.max[l][n];
}

export type NowMs = () => number;

/**
 * Samples every texel of every face and builds the pyramid. Deterministic: the same layout and sampler give the same
 * array. `now` is injectable for timing in specs; it only feeds the reported milliseconds.
 */
export function bakeHeights(layout: BakeLayout, sampler: HeightSampler, now: NowMs = () => performance.now()): BakedHeights {
  if (!Number.isInteger(layout.k) || layout.k < MIN_BAKE_K || layout.k > MAX_BAKE_K) throw new Error(`Bake k ${layout.k} is outside ${MIN_BAKE_K}..${MAX_BAKE_K}`);
  const faces = bakeFaces(layout.kind);
  const side = bakeSide(layout.k);
  const texels = new Float32Array(faces * side * side);
  const bakeMsPerFace: number[] = [];
  const point: Vec3 = [0, 0, 0];
  let minM = Infinity;
  let maxM = -Infinity;
  for (let face = 0; face < faces; face++) {
    const began = now();
    const base = face * side * side;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        texelPoint(layout, face, i, j, point);
        const h = Math.fround(sampler(point[0], point[1], point[2]));
        if (!Number.isFinite(h)) throw new Error(`Sampler returned ${h} at face ${face} texel ${i}, ${j}`);
        texels[base + j * side + i] = h;
        if (h < minM) minM = h;
        if (h > maxM) maxM = h;
      }
    }
    bakeMsPerFace.push(now() - began);
  }
  const began = now();
  const pyramid = buildPyramid(texels, layout.k, faces);
  const top = pyramid.cells >> layout.k;
  let boundM = 0;
  for (let n = 0; n < faces * top * top; n++) boundM = Math.max(boundM, Math.abs(pyramid.min[layout.k][n]), Math.abs(pyramid.max[layout.k][n]));
  return { layout, side, faces, texels, pyramid, minM, maxM, boundM, bakeMsPerFace, pyramidMs: now() - began };
}

/** Probe points for the CPU-twin check: lattice points spread over the faces, none on a texel centre. */
export const PROBE_COUNT = 64;

export interface BakeProbes {
  /** Per probe: face, lattice coordinates (integers, 0..L, never a multiple of the texel step) and the sampler's own value there, metres. */
  readonly face: readonly number[];
  readonly u: readonly number[];
  readonly v: readonly number[];
  readonly direct: readonly number[];
}

/**
 * Deterministic probe lattice points: probe n is on face n mod faces, at the R2 low-discrepancy sequence position
 * (0.5 + n * 0.7549, 0.5 + n * 0.5698) of the face, rounded to a lattice integer. A coordinate that landed on a texel
 * centre is moved by a third of a texel, so every probe tests the interpolation.
 */
export function probeLattice(layout: BakeLayout, count = PROBE_COUNT): Omit<BakeProbes, 'direct'> {
  const faces = bakeFaces(layout.kind);
  const unit = texelLattice(layout.k);
  const face: number[] = [];
  const u: number[] = [];
  const v: number[] = [];
  const place = (fraction: number): number => {
    let value = Math.round((fraction - Math.floor(fraction)) * MAX_LATTICE_STEPS);
    if (value % unit === 0) value += Math.round(unit / 3);
    return Math.min(MAX_LATTICE_STEPS - 1, value);
  };
  for (let n = 0; n < count; n++) {
    face.push(n % faces);
    u.push(place(0.5 + n * 0.7548776662466927));
    v.push(place(0.5 + n * 0.5698402909980532));
  }
  return { face, u, v };
}

/** The sampler's own value (not the texture's) at each probe point. */
export function sampleProbes(layout: BakeLayout, sampler: HeightSampler, count = PROBE_COUNT): BakeProbes {
  const probes = probeLattice(layout, count);
  const point: Vec3 = [0, 0, 0];
  const direct = probes.face.map((face, n) => {
    latticePoint(layout, face, probes.u[n], probes.v[n], point);
    return sampler(point[0], point[1], point[2]);
  });
  return { ...probes, direct };
}

/**
 * |CPU twin - sampler| at each probe, metres. The twin is the bilinear read of the texture (`latticeHeightF32`, float32),
 * so this is the interpolation error of the texture between its texels, plus float32 rounding. It is NOT a GPU
 * read-back: it says nothing about what the vertex stage computes, only how far the CPU twin is from the source.
 */
export function twinErrors(probes: BakeProbes, twin: (face: number, u: number, v: number) => number): number[] {
  return probes.face.map((face, n) => Math.abs(twin(face, probes.u[n], probes.v[n]) - probes.direct[n]));
}

/** Nearest-rank percentile (p in 0..1) of unsorted values; 0 for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Buffers of a baked result, for `postMessage` transfer. */
export function bakeBuffers(baked: BakedHeights): ArrayBuffer[] {
  return [baked.texels.buffer as ArrayBuffer, ...baked.pyramid.min.map((a) => a.buffer as ArrayBuffer), ...baked.pyramid.max.map((a) => a.buffer as ArrayBuffer)];
}

/** Texture size in MB (10^6 bytes) of a baked result. */
export const textureMegabytes = (baked: BakedHeights): number => baked.texels.byteLength / 1e6;
