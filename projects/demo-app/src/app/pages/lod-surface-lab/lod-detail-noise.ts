/* eslint-disable @typescript-eslint/no-explicit-any */
import { float, int, max, smoothstep, uint, vec3 } from 'three/tsl';
import type { DomainKind, LodDomain, Vec3 } from './lod-domain';
import { MAX_LATTICE_STEPS, cubeLattice } from './lod-lattice';
import { latticeOfPosition, type BakeLayout } from './lod-height-bake';
import type { HeightSource } from './lod-height';

/**
 * Detail noise below the texel size (Plan 059, runbook 059 entry 2026-10-28): the baked height texture is read bilinearly, so
 * between its texels the ground is a flat facet. This adds a few octaves of value noise to the height, after the texture
 * read, with the same function on the CPU (here) and in the vertex stage ({@link detailNoiseNode}).
 *
 * The noise is a function of the vertex's lattice point alone (plane: (U, V); sphere: the cube-lattice vector T, which both
 * faces of an edge vertex share), so every leaf that draws a point gets the same offset and patch edges stay exact. Its
 * largest wavelength is one texel and each octave halves it. The fade of the finest octaves depends on the vertex's
 * distance to the camera, again a function of the point only, never of the leaf's level (neighbouring levels differ).
 *
 * Amplitude is a share of the texel size in metres; value noise stays in [-1, 1] per octave, so the offset never exceeds
 * `amplitude * DETAIL_UNIT_BOUND`.
 */

/** Octaves, from one texel down by factors of two. */
export const DETAIL_OCTAVES = 4;
/** Each octave's amplitude relative to the one before. */
export const DETAIL_GAIN = 0.5;
/** Largest |unit noise|: the sum of the octave weights. */
export const DETAIL_UNIT_BOUND = Array.from({ length: DETAIL_OCTAVES }, (_, o) => DETAIL_GAIN ** o).reduce((a, b) => a + b, 0);
/** An octave whose wavelength is under this many vertex spacings contributes nothing; it is fully in from {@link DETAIL_FADE_FULL}. */
export const DETAIL_FADE_ZERO = 2;
export const DETAIL_FADE_FULL = 4;

const HASH_X = 0x27d4eb2d;
const HASH_Y = 0x165667b1;
const HASH_Z = 0x9e3779b1;
const MIX_A = 0x2c1b3c6d;
const MIX_B = 0x297a2d39;
/** Keeps cell indices positive, so the u32 hash never sees a negative i32 (the CPU and the GPU convert those alike, but this need not rely on it). */
const CELL_BIAS = 1 << 20;
/** Per-octave shift of the lattice, so the integer planes the cube-face points sit on do not line up with a noise cell boundary. */
const OCTAVE_SHIFT: readonly Vec3[] = [[0.31, 0.57, 0.83], [0.71, 0.23, 0.47], [0.13, 0.91, 0.39], [0.67, 0.41, 0.19]];

/** Lattice hash of integer cell (x, y, z) to [-1, 1): 24 bits, exact in float32. */
export function detailHash(x: number, y: number, z: number): number {
  let h = Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y) ^ Math.imul(z, HASH_Z);
  h ^= h >>> 15;
  h = Math.imul(h, MIX_A);
  h ^= h >>> 12;
  h = Math.imul(h, MIX_B);
  h ^= h >>> 15;
  return (h >>> 8) / 8388608 - 1;
}

const smooth01 = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Weight of octave `o` (0 = one texel) at a vertex `distanceM` from the camera when a vertex spacing there is
 * `distanceM * spacingAngle`: 0 under {@link DETAIL_FADE_ZERO} spacings per wavelength, 1 from {@link DETAIL_FADE_FULL}.
 */
export function detailOctaveFade(octave: number, texelM: number, distanceM: number, spacingAngle: number): number {
  const spacing = Math.max(distanceM, 1e-3) * spacingAngle;
  return smooth01(DETAIL_FADE_ZERO, DETAIL_FADE_FULL, texelM / 2 ** octave / spacing);
}

/**
 * Unit detail noise at p (texel units: one noise cell of the first octave per unit): sum of octave weights times value noise
 * in [-1, 1] with quintic interpolation, in [-DETAIL_UNIT_BOUND, DETAIL_UNIT_BOUND]. `fades` gives each octave's weight
 * (default 1). When `gradient` is given it receives the analytic d(noise)/dp. Pure function of p and `fades`.
 */
export function detailNoise(px: number, py: number, pz: number, fades?: ArrayLike<number>, gradient?: Vec3): number {
  let sum = 0;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let o = 0; o < DETAIL_OCTAVES; o++) {
    const weight = DETAIL_GAIN ** o * (fades ? fades[o] : 1);
    if (weight === 0) continue;
    const scale = 2 ** o;
    const shift = OCTAVE_SHIFT[o];
    const qx = px * scale + shift[0];
    const qy = py * scale + shift[1];
    const qz = pz * scale + shift[2];
    const fx = Math.floor(qx);
    const fy = Math.floor(qy);
    const fz = Math.floor(qz);
    const dx = qx - fx;
    const dy = qy - fy;
    const dz = qz - fz;
    const ux = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
    const uy = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
    const uz = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
    const ix = fx + CELL_BIAS;
    const iy = fy + CELL_BIAS;
    const iz = fz + CELL_BIAS;
    const a = detailHash(ix, iy, iz);
    const b = detailHash(ix + 1, iy, iz);
    const c = detailHash(ix, iy + 1, iz);
    const d = detailHash(ix + 1, iy + 1, iz);
    const e = detailHash(ix, iy, iz + 1);
    const f = detailHash(ix + 1, iy, iz + 1);
    const g = detailHash(ix, iy + 1, iz + 1);
    const h = detailHash(ix + 1, iy + 1, iz + 1);
    const k1 = b - a;
    const k2 = c - a;
    const k3 = e - a;
    const k4 = a - b - c + d;
    const k5 = a - c - e + g;
    const k6 = a - b - e + f;
    const k7 = -a + b + c - d + e - f - g + h;
    sum += weight * (a + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz);
    if (gradient) {
      const dux = 30 * dx * dx * (dx - 1) * (dx - 1);
      const duy = 30 * dy * dy * (dy - 1) * (dy - 1);
      const duz = 30 * dz * dz * (dz - 1) * (dz - 1);
      const w = weight * scale;
      gx += w * dux * (k1 + k4 * uy + k6 * uz + k7 * uy * uz);
      gy += w * duy * (k2 + k4 * ux + k5 * uz + k7 * ux * uz);
      gz += w * duz * (k3 + k5 * uy + k6 * ux + k7 * ux * uy);
    }
  }
  if (gradient) {
    gradient[0] = gx;
    gradient[1] = gy;
    gradient[2] = gz;
  }
  return sum;
}

/** Metres between two texel centres of a `cells`-per-side texture over the domain (a cube face spans a quarter turn on the sphere). */
export function detailTexelMetres(domain: Pick<LodDomain, 'kind' | 'sizeM'>, cells: number): number {
  return (domain.kind === 'plane' ? domain.sizeM : (Math.PI / 2) * domain.sizeM) / cells;
}

/** Noise coordinate (texel units) of face lattice point (u, v), lattice side 2^24, texture of `cells` texels per side. Plane: (U, V, 0); sphere: the cube-lattice vector T over two texels. */
export function detailPoint(kind: DomainKind, cells: number, face: number, u: number, v: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const unit = MAX_LATTICE_STEPS / cells;
  if (kind === 'plane') {
    out[0] = u / unit;
    out[1] = v / unit;
    out[2] = 0;
    return out;
  }
  cubeLattice(face, u, v, MAX_LATTICE_STEPS, out);
  for (let k = 0; k < 3; k++) out[k] /= 2 * unit;
  return out;
}

/** Unit noise at face lattice point (u, v) with every octave in (the CPU twin of the vertex stage at full detail). */
export function detailAtLattice(kind: DomainKind, cells: number, face: number, u: number, v: number, gradient?: Vec3): number {
  const p = detailPoint(kind, cells, face, u, v, [0, 0, 0]);
  return detailNoise(p[0], p[1], p[2], undefined, gradient);
}

/** What a height source is wrapped with: the domain, the texture side the noise is sized by, and the amplitude share of the texel. */
export interface DetailNoiseOptions {
  readonly domain: LodDomain;
  /** Texels per face side of the height texture (2^k). */
  readonly cells: number;
  /** Amplitude of the first octave as a share of the texel size in metres; 0 or less leaves the source as it is. */
  readonly share: number;
}

/** Largest |offset| the noise adds, metres. */
export const detailBoundM = (options: DetailNoiseOptions): number => Math.max(0, options.share) * detailTexelMetres(options.domain, options.cells) * DETAIL_UNIT_BOUND;

/**
 * The CPU side of the noise as a height source: heights (full detail, no distance fade), the global bound and node ranges
 * widened by {@link detailBoundM}, so culling and the split box stay conservative. With no amplitude the source itself is returned.
 */
export function withDetailNoise(source: HeightSource, options: DetailNoiseOptions): HeightSource {
  if (!(options.share > 0)) return source;
  const { domain, cells } = options;
  const amplitude = options.share * detailTexelMetres(domain, cells);
  const bound = detailBoundM(options);
  const layout: BakeLayout = { kind: domain.kind, warp: domain.warp, sizeM: domain.sizeM, k: Math.round(Math.log2(cells)) };
  const place = { face: 0, u: 0, v: 0 };
  const range = source.nodeRange?.bind(source);
  return {
    ...source,
    boundM: source.boundM + bound,
    heightAt(x, y, z) {
      latticeOfPosition(layout, x, y, z, place);
      return source.heightAt(x, y, z) + amplitude * detailAtLattice(domain.kind, cells, place.face, place.u, place.v);
    },
    ...(range ? { nodeRange: (root: number, level: number, i: number, j: number, out: [number, number]) => {
      range(root, level, i, j, out);
      out[0] -= bound;
      out[1] += bound;
    } } : {}),
  };
}

/** The vertex stage's twin of {@link detailHash}; x, y, z are u32 nodes. */
const hashNode = (x: any, y: any, z: any): any => {
  let h: any = x.mul(uint(HASH_X)).bitXor(y.mul(uint(HASH_Y))).bitXor(z.mul(uint(HASH_Z)));
  h = h.bitXor(h.shiftRight(uint(15)));
  h = h.mul(uint(MIX_A));
  h = h.bitXor(h.shiftRight(uint(12)));
  h = h.mul(uint(MIX_B));
  h = h.bitXor(h.shiftRight(uint(15)));
  return float(h.shiftRight(uint(8))).div(8388608).sub(1);
};

/** The vertex stage's twin of {@link detailNoise} and {@link detailOctaveFade}: `{ value, gradient }` for the noise coordinate node `p` (vec3), at `distance` metres from the camera. */
export function detailNoiseNode(p: any, distance: any, spacingAngle: any, texelM: number): { value: any; gradient: any } {
  const spacing = max(distance, 1e-3).mul(spacingAngle);
  let value: any = float(0);
  let gradient: any = vec3(0, 0, 0);
  for (let o = 0; o < DETAIL_OCTAVES; o++) {
    const scale = 2 ** o;
    const fade = smoothstep(DETAIL_FADE_ZERO, DETAIL_FADE_FULL, float(texelM / scale).div(spacing));
    const weight = fade.mul(DETAIL_GAIN ** o);
    const q = p.mul(scale).add(vec3(...OCTAVE_SHIFT[o]));
    const cell = q.floor();
    const d = q.sub(cell);
    const u = d.mul(d).mul(d).mul(d.mul(d.mul(6).sub(15)).add(10));
    const du = d.mul(d).mul(d.sub(1)).mul(d.sub(1)).mul(30);
    const ix = uint(int(cell.x)).add(uint(CELL_BIAS));
    const iy = uint(int(cell.y)).add(uint(CELL_BIAS));
    const iz = uint(int(cell.z)).add(uint(CELL_BIAS));
    const corner = (dx: number, dy: number, dz: number) => hashNode(ix.add(uint(dx)), iy.add(uint(dy)), iz.add(uint(dz)));
    const a = corner(0, 0, 0);
    const b = corner(1, 0, 0);
    const c = corner(0, 1, 0);
    const dd = corner(1, 1, 0);
    const e = corner(0, 0, 1);
    const f = corner(1, 0, 1);
    const g = corner(0, 1, 1);
    const h = corner(1, 1, 1);
    const k1 = b.sub(a);
    const k2 = c.sub(a);
    const k3 = e.sub(a);
    const k4 = a.sub(b).sub(c).add(dd);
    const k5 = a.sub(c).sub(e).add(g);
    const k6 = a.sub(b).sub(e).add(f);
    const k7 = a.negate().add(b).add(c).sub(dd).add(e).sub(f).sub(g).add(h);
    const n = a.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k3.mul(u.z)).add(k4.mul(u.x).mul(u.y)).add(k5.mul(u.y).mul(u.z)).add(k6.mul(u.z).mul(u.x)).add(k7.mul(u.x).mul(u.y).mul(u.z));
    const gx = du.x.mul(k1.add(k4.mul(u.y)).add(k6.mul(u.z)).add(k7.mul(u.y).mul(u.z)));
    const gy = du.y.mul(k2.add(k4.mul(u.x)).add(k5.mul(u.z)).add(k7.mul(u.x).mul(u.z)));
    const gz = du.z.mul(k3.add(k5.mul(u.y)).add(k6.mul(u.x)).add(k7.mul(u.x).mul(u.y)));
    value = value.add(weight.mul(n));
    gradient = gradient.add(vec3(gx, gy, gz).mul(weight.mul(scale)));
  }
  return { value, gradient };
}
