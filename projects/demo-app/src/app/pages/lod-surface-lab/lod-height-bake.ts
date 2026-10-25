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
  const cx = cubeComponent(out[0], MAX_LATTICE_STEPS, layout.warp);
  const cy = cubeComponent(out[1], MAX_LATTICE_STEPS, layout.warp);
  const cz = cubeComponent(out[2], MAX_LATTICE_STEPS, layout.warp);
  const scale = layout.sizeM / Math.hypot(cx, cy, cz);
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
        const lo = Math.min(a, b, c, d);
        const hi = Math.max(a, b, c, d);
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

/** Buffers of a baked result, for `postMessage` transfer. */
export function bakeBuffers(baked: BakedHeights): ArrayBuffer[] {
  return [baked.texels.buffer as ArrayBuffer, ...baked.pyramid.min.map((a) => a.buffer as ArrayBuffer), ...baked.pyramid.max.map((a) => a.buffer as ArrayBuffer)];
}

/** Texture size in MB (10^6 bytes) of a baked result. */
export const textureMegabytes = (baked: BakedHeights): number => baked.texels.byteLength / 1e6;
