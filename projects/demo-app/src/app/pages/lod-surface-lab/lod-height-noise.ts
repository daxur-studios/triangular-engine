import { bakeHeights, sampleProbes, type BakeLayout, type BakeProbes, type BakedHeights, type HeightSampler } from './lod-height-bake';
import { bumpsFor } from './lod-height';
import { cellPlanetFor, cellPlanetSampler, cellPlanetWorld, cliffSampler, type CellPlanetDescription } from './lod-height-terrain';

/**
 * Plan 059 steps 2 and 3: the sampler registry for the baked sources. Plain value-noise fBm and a texel-aware copy of the
 * static bumps live here; the cell planet and the cliff are in `lod-height-terrain.ts`. A sampler is a pure function of
 * the base-surface position.
 */

/** Identifiers of the baked sources that a worker can rebuild by name (functions do not cross `postMessage`). */
export type BakedSourceId = 'noise' | 'bumps-baked' | 'cell-planet' | 'cliff' | 'biome-mix';

/** Axis multipliers of the lattice hash; one per axis so a corner is the xor of three products. */
const HASH_X = 0x27d4eb2d;
const HASH_Y = 0x165667b1;
const HASH_Z = 0x9e3779b1;
const HASH_SEED = 0x85ebca6b;

/** Final mix of a lattice hash `h` (xor of the axis products and the seed term) to [-1, 1). Pure integer arithmetic, no allocation. */
function finishHash(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}

/** Integer lattice hash to [-1, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  return finishHash(Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y) ^ Math.imul(z, HASH_Z) ^ Math.imul(seed, HASH_SEED));
}

/**
 * Value noise in [-1, 1]: smooth (quintic) trilinear blend of hashed lattice corners. The hot path of the bake (millions
 * of calls), so it allocates nothing: the axis products are formed once per axis and shared by the corners, and the blend
 * is written out. A pure function of (x, y, z, seed), so a point shared by two cube faces gets one value.
 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  const tx = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
  const ty = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  const tz = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
  const ix = fx | 0;
  const iy = fy | 0;
  const iz = fz | 0;
  const x0 = Math.imul(ix, HASH_X);
  const x1 = Math.imul(ix + 1, HASH_X);
  const y0 = Math.imul(iy, HASH_Y);
  const y1 = Math.imul(iy + 1, HASH_Y);
  const z0 = Math.imul(iz, HASH_Z) ^ Math.imul(seed, HASH_SEED);
  const z1 = Math.imul(iz + 1, HASH_Z) ^ Math.imul(seed, HASH_SEED);
  const c000 = finishHash(x0 ^ y0 ^ z0);
  const c100 = finishHash(x1 ^ y0 ^ z0);
  const c010 = finishHash(x0 ^ y1 ^ z0);
  const c110 = finishHash(x1 ^ y1 ^ z0);
  const c001 = finishHash(x0 ^ y0 ^ z1);
  const c101 = finishHash(x1 ^ y0 ^ z1);
  const c011 = finishHash(x0 ^ y1 ^ z1);
  const c111 = finishHash(x1 ^ y1 ^ z1);
  const a0 = c000 + (c100 - c000) * tx;
  const a1 = c010 + (c110 - c010) * tx;
  const b0 = c001 + (c101 - c001) * tx;
  const b1 = c011 + (c111 - c011) * tx;
  const lo = a0 + (a1 - a0) * ty;
  const hi = b0 + (b1 - b0) * ty;
  return lo + (hi - lo) * tz;
}

/** Metres between two texel centres at the middle of a face (the sphere's equal-angle cells are about this wide). */
export function texelMetres(layout: BakeLayout): number {
  const side = layout.kind === 'plane' ? layout.sizeM : 2 * layout.sizeM;
  return side / 2 ** layout.k;
}

/** Peak height of the noise source: a few hundred metres on the sphere, the same on the 100 km plane. */
export function noiseAmplitudeM(layout: BakeLayout): number {
  return Math.min(300, 0.03 * layout.sizeM);
}

/**
 * Fractal value noise of the position, in [-amplitude, amplitude]. Octaves halve in wavelength and amplitude from half the
 * body's size (a fifth of the plane's side) down to four texels, so no octave aliases the texture.
 */
export function noiseSampler(layout: BakeLayout, seed = 1): HeightSampler {
  const amplitude = noiseAmplitudeM(layout);
  const base = layout.kind === 'plane' ? layout.sizeM / 5 : layout.sizeM / 2;
  const octaves = Math.max(1, Math.min(10, Math.floor(Math.log2(base / (4 * texelMetres(layout)))) + 1));
  // Per-octave constants, formed once: the sampler runs once per texel, millions of times.
  const frequency = new Float64Array(octaves);
  const weight = new Float64Array(octaves);
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    frequency[o] = 2 ** o / base;
    weight[o] = 0.5 ** o;
    total += weight[o];
  }
  return (x, y, z) => {
    let h = 0;
    for (let o = 0; o < octaves; o++) {
      const f = frequency[o];
      h += weight[o] * valueNoise3(x * f + 11.3 * o, y * f - 7.1 * o, z * f + 3.7 * o, seed + o);
    }
    return (amplitude * h) / total;
  };
}

/** The static bumps with the sines the texture can resolve (wavelength of at least four texels) kept; the rest would alias. */
export function bakedBumpsSampler(layout: BakeLayout): HeightSampler {
  const minWavelength = 4 * texelMetres(layout);
  const bumps = bumpsFor(layout.kind).filter((bump) => bump.wavelengthM >= minWavelength);
  return (x, y, z) => {
    let h = 0;
    for (const { axis, wavelengthM, amplitudeM, phase } of bumps) h += amplitudeM * Math.sin(((2 * Math.PI) / wavelengthM) * (x * axis[0] + y * axis[1] + z * axis[2]) + phase);
    return h;
  };
}

/** Five regions run from x=-0.4 to x=0.4. Sphere longitude uses 1.8 radians per unit;
 * latitude fades the strip out before the longitude wrap, preserving continuity everywhere. */
export function biomeMixSampler(layout: BakeLayout): HeightSampler {
  const amplitude = Math.min(2000, layout.sizeM * 0.06);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return (x, y, z) => {
    const r = Math.hypot(x, y, z);
    const u = layout.kind === 'plane' ? x / layout.sizeM : Math.atan2(x, z) / 1.8;
    const v = layout.kind === 'plane' ? z / layout.sizeM : Math.asin(Math.max(-1, Math.min(1, y / r))) / 1.8;
    const meadow = 3 * Math.sin(22 * u) * Math.cos(19 * v);
    const hills = amplitude * 0.035 * (1 + Math.sin(28 * u) * Math.cos(24 * v));
    const warp = valueNoise3(u * 11, v * 11, 0, 59);
    const ridge = 1 - Math.abs(Math.sin(37 * u + 4 * Math.sin(12 * v) + 2 * warp));
    const mountain = amplitude * (0.12 + 0.88 * ridge ** 2) * (0.55 + 0.45 * Math.cos(12 * v) ** 2);
    const radius = Math.hypot((u - 0.2) / 0.12, v / 0.12);
    const cone = Math.max(0, 1 - radius);
    const crater = 1 - smooth(0.18, 0.30, radius);
    const volcano = amplitude * Math.max(0, cone - 0.48 * crater);
    const canyonDistance = Math.abs(v - 0.055 * Math.sin(24 * u));
    const canyon = amplitude * 0.23 * smooth(0.015, 0.037, canyonDistance);
    let h = meadow;
    h += (hills - h) * smooth(-0.34, -0.26, u);
    h += (mountain - h) * smooth(-0.14, -0.06, u);
    h += (volcano - h) * smooth(0.06, 0.14, u);
    h += (canyon - h) * smooth(0.26, 0.34, u);
    if (layout.kind === 'sphere') h *= (1 - smooth(0.38, 0.48, Math.abs(v))) * (1 - smooth(0.55, 0.7, Math.abs(u)));
    return h;
  };
}

/** A sampler and what it cost to make: the cell planet builds a world first (seconds), the others are free. */
export interface BakeSource {
  readonly sampler: HeightSampler;
  /** Wall time of the world build behind the sampler, ms; absent for sources without one. */
  readonly worldBuildMs?: number;
}

/**
 * The sampler of a source by name. `planet` is the cell planet's description (default: the one for this layout's size);
 * the cell planet is a sphere source.
 */
export function bakeSourceFor(id: BakedSourceId, layout: BakeLayout, planet: CellPlanetDescription = cellPlanetFor(layout.sizeM)): BakeSource {
  switch (id) {
    case 'noise': return { sampler: noiseSampler(layout) };
    case 'bumps-baked': return { sampler: bakedBumpsSampler(layout) };
    case 'cliff': return { sampler: cliffSampler(layout) };
    case 'biome-mix': return { sampler: biomeMixSampler(layout) };
    case 'cell-planet': {
      if (layout.kind !== 'sphere') throw new Error('The cell planet source is a sphere source');
      const { world, buildMs } = cellPlanetWorld(planet);
      return { sampler: cellPlanetSampler(world, planet.heightScaleM), worldBuildMs: buildMs };
    }
  }
}

export function samplerFor(id: BakedSourceId, layout: BakeLayout, planet?: CellPlanetDescription): HeightSampler {
  return bakeSourceFor(id, layout, planet).sampler;
}

/** A finished bake with the probe values for the CPU-twin check (see `twinErrors`). */
export interface BakeOutput {
  readonly baked: BakedHeights;
  readonly probes: BakeProbes;
  readonly worldBuildMs?: number;
}

/** Everything the worker does for a request, so the inline fallback and the specs run the same code. */
export function runBake(id: BakedSourceId, layout: BakeLayout, planet?: CellPlanetDescription): BakeOutput {
  const { sampler, worldBuildMs } = bakeSourceFor(id, layout, planet);
  const baked = bakeHeights(layout, sampler);
  return { baked, probes: sampleProbes(layout, sampler), ...(worldBuildMs === undefined ? {} : { worldBuildMs }) };
}
