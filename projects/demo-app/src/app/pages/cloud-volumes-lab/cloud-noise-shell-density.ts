import { shellIntervals } from './cloud-noise-shell-interval';

/**
 * Plain-TypeScript twin of `CloudNoiseShell`'s density and transmittance (no lighting). The spec uses it to check what a
 * view ray actually sees: how much of the planet disc is covered, whether the cover is the same on every side, and whether
 * the limb has structure. Keep the rules and defaults in step with the shader in `cloud-noise-shell.ts`.
 *
 * The noise is Ken Perlin's improved gradient noise on a repeating lattice. The shader reads the same noise from a cube
 * baked by {@link bakeShellNoise}, so the twin matches it up to the texture's interpolation. It is zero at every integer
 * lattice point, which is why the domain is offset (see below).
 */

/** Shape and look of the cloud layer. */
export interface CloudShellLook {
  /** Fraction of the planet disc covered seen face-on, roughly 0..1. */
  readonly coverage: number;
  /** Noise frequency in 1/metres; 1/900 gives cumulus cells about 900 m across, several per hemisphere. */
  readonly frequency: number;
  /** Width of the density ramp in noise units; smaller is crisper. */
  readonly softness: number;
  /** Extinction per metre at density 1. */
  readonly extinction: number;
}

/** Shell geometry, all radii in metres from the planet centre. */
export interface CloudShellGeometry {
  readonly planetRadius: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
}

/**
 * The lab's shell on its 2000 m planet. The floor sits just above the ground and the density erodes the bottom 30 % (see
 * {@link domeThreshold}), so cloud bases vary (about 110-160 m up) instead of forming a sphere. A floor high above the
 * ground (it was 150 m) leaves a gap under the deck: at the limb, rays pass through it and see the far side of the shell
 * as a separate smooth band outside the planet's edge.
 */
export const CLOUD_SHELL_LAB = { planetRadius: 2000, baseAltitude: 20, thickness: 450 } as const;

/** Lab defaults; the shader's uniforms start at these values. */
export const CLOUD_SHELL_LOOK: CloudShellLook = { coverage: 0.7, frequency: 1 / 900, softness: 0.25, extinction: 0.012 };

/**
 * Noise-space offset of the whole domain. Gradient noise is zero at every lattice point, and with an unshifted domain the
 * planet centre sits on one: the lowest octave then becomes a near-linear ramp across the planet, clear on one side and
 * cloudy on the other.
 */
export const CLOUD_SHELL_NOISE_OFFSET: readonly [number, number, number] = [37.13, 11.71, -23.57];

/** Spread of the fractal noise (standard deviation of `fractalNoise`, measured); the coverage threshold is scaled by it. */
export const CLOUD_SHELL_NOISE_SPREAD = 0.31;

/** March step length in metres and the step cap per interval. */
export const CLOUD_SHELL_STEP = 60;
export const CLOUD_SHELL_MAX_STEPS = 32;

/** Edge of the baked noise cube in voxels, and how many lowest-octave noise cells it holds per axis (it tiles). */
export const CLOUD_SHELL_TEXTURE_SIZE = 128;
export const CLOUD_SHELL_TILE_CELLS = 8;
/** Octaves baked into the cube. Three keeps the finest at 4 voxels per cell, so trilinear reads stay smooth. */
export const CLOUD_SHELL_TEXTURE_OCTAVES = 3;
/** Noise value stored as 1 in the 0..1 texel (0 stays at 0.5); the sum rarely goes past it. */
export const CLOUD_SHELL_TEXTURE_RANGE = 1.25;
/** A second read of the cube at this scale and weight continues the octave series, so it adds the fine detail. */
export const CLOUD_SHELL_DETAIL_SCALE = 8;
export const CLOUD_SHELL_DETAIL_WEIGHT = 0.125;

const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1234567;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return Uint8Array.from({ length: 512 }, (_, i) => p[i & 255]);
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const grad = (hash: number, x: number, y: number, z: number) => {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
};

/** Improved Perlin noise, about [-1, 1], zero on integer lattice points. */
export function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return (
    0.982 *
    lerp(
      lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  );
}

/** Same octave sum as `mx_fractal_noise_float(p, 5, 2.1, 0.5)`. */
export function fractalNoise(x: number, y: number, z: number, octaves = 5, lacunarity = 2.1, diminish = 0.5): number {
  let result = 0;
  let amplitude = 1;
  for (let i = 0; i < octaves; i++) {
    result += amplitude * perlin3(x, y, z);
    amplitude *= diminish;
    x *= lacunarity;
    y *= lacunarity;
    z *= lacunarity;
  }
  return result;
}

const wrap = (i: number, period: number) => ((i % period) + period) % period;

/** {@link perlin3} on a lattice that repeats every `period` cells, so a baked cube of it tiles without a seam. */
export function tiledPerlin(x: number, y: number, z: number, period: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const [x0, x1] = [wrap(fx, period), wrap(fx + 1, period)];
  const [y0, y1] = [wrap(fy, period), wrap(fy + 1, period)];
  const [z0, z1] = [wrap(fz, period), wrap(fz + 1, period)];
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  const u = fade(dx);
  const v = fade(dy);
  const w = fade(dz);
  const corner = (ix: number, iy: number, iz: number, gx: number, gy: number, gz: number) =>
    grad(PERM[PERM[PERM[ix] + iy] + iz], gx, gy, gz);
  return (
    0.982 *
    lerp(
      lerp(
        lerp(corner(x0, y0, z0, dx, dy, dz), corner(x1, y0, z0, dx - 1, dy, dz), u),
        lerp(corner(x0, y1, z0, dx, dy - 1, dz), corner(x1, y1, z0, dx - 1, dy - 1, dz), u),
        v,
      ),
      lerp(
        lerp(corner(x0, y0, z1, dx, dy, dz - 1), corner(x1, y0, z1, dx - 1, dy, dz - 1), u),
        lerp(corner(x0, y1, z1, dx, dy - 1, dz - 1), corner(x1, y1, z1, dx - 1, dy - 1, dz - 1), u),
        v,
      ),
      w,
    )
  );
}

/** What one read of the baked cube holds at noise-space point (x, y, z): the octave sum, repeating every `CLOUD_SHELL_TILE_CELLS`. */
export function tiledFractal(x: number, y: number, z: number): number {
  let result = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let i = 0; i < CLOUD_SHELL_TEXTURE_OCTAVES; i++) {
    result += amplitude * tiledPerlin(x * frequency, y * frequency, z * frequency, CLOUD_SHELL_TILE_CELLS * frequency);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return result;
}

/** The cube the shader reads: one byte per voxel, sampled at voxel centres, `CLOUD_SHELL_TEXTURE_RANGE` mapped to 0..255. */
export function bakeShellNoise(size = CLOUD_SHELL_TEXTURE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * size);
  const cell = CLOUD_SHELL_TILE_CELLS / size;
  let index = 0;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const n = tiledFractal((i + 0.5) * cell, (j + 0.5) * cell, (k + 0.5) * cell);
        data[index++] = Math.round(Math.min(1, Math.max(0, (n / CLOUD_SHELL_TEXTURE_RANGE) * 0.5 + 0.5)) * 255);
      }
    }
  }
  return data;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Density at world point `p` and normalised shell height `h` (0 = floor, 1 = top). The height shapes the threshold, not
 * the result: cells are narrower near the floor and much narrower toward the top, so each cell is a dome rather than a
 * slab with a flat lid.
 */
export function shellDensity(p: readonly number[], h: number, look: CloudShellLook, offset = CLOUD_SHELL_NOISE_OFFSET): number {
  if (h <= 0 || h >= 1) return 0;
  const x = p[0] * look.frequency + offset[0];
  const y = p[1] * look.frequency + offset[1];
  const z = p[2] * look.frequency + offset[2];
  const scale = CLOUD_SHELL_DETAIL_SCALE;
  const n = tiledFractal(x, y, z) + CLOUD_SHELL_DETAIL_WEIGHT * tiledFractal(x * scale, y * scale, z * scale);
  const threshold = (0.5 - look.coverage) * 2.6 * CLOUD_SHELL_NOISE_SPREAD + domeThreshold(h);
  return smoothstep(threshold, threshold + look.softness, n);
}

/**
 * Extra threshold by height. Both ends of the shell are eroded so strongly that almost no cell touches either sphere, so
 * neither sphere can show as a crisp circle:
 * - the bottom 30 % is eroded, so cloud bases sit at varying heights well above the geometric floor (only dense cores
 *   reach lower). With the floor itself close to the ground, rays at the limb barely pass under it, so the far side of the
 *   shell is not seen as a separate band through a gap under the deck;
 * - the top is eroded from 40 % up, so a grazing ray at the top crosses only the odd tower and the limb is ragged.
 */
export function domeThreshold(h: number): number {
  const top = smoothstep(0.4, 1, h);
  return 0.9 * (1 - smoothstep(0, 0.3, h)) + top * top;
}

/** Opacity (1 - transmittance) a ray collects through the shell. `jitter` in [0, 1) offsets the samples like the shader's. */
export function shellAlpha(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  geometry: CloudShellGeometry,
  look: CloudShellLook = CLOUD_SHELL_LOOK,
  jitter = 0.5,
  offset = CLOUD_SHELL_NOISE_OFFSET,
): number {
  const { near, far } = shellIntervals(origin, dir, geometry.planetRadius, geometry.innerRadius, geometry.outerRadius);
  const thickness = geometry.outerRadius - geometry.innerRadius;
  let transmittance = 1;
  for (const interval of [near, far]) {
    const length = interval.end - interval.start;
    if (length <= 0 || transmittance < 0.02) continue;
    const count = Math.min(Math.max(Math.ceil(length / CLOUD_SHELL_STEP), 8), CLOUD_SHELL_MAX_STEPS);
    const dt = length / count;
    for (let i = 0; i < count && transmittance >= 0.02; i++) {
      const t = interval.start + (i + jitter) * dt;
      const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const h = (Math.hypot(p[0], p[1], p[2]) - geometry.innerRadius) / thickness;
      transmittance *= Math.exp(-shellDensity(p, h, look, offset) * look.extinction * dt);
    }
  }
  return 1 - transmittance;
}
