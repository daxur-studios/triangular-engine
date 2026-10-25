import type { BakeLayout, HeightSampler } from './lod-height-bake';
import { bumpsFor } from './lod-height';

/**
 * Plan 059 step 2 samplers for the baked sources: plain value-noise fBm and a texel-aware copy of the static bumps. A
 * sampler is a pure function of the base-surface position, so the cell planet's surface sampler can plug in the same way
 * later (`createPlanetSurfaceSampler` from `triangular-engine/worldgen`).
 */

/** Identifiers of the baked sources that a worker can rebuild by name (functions do not cross `postMessage`). */
export type BakedSourceId = 'noise' | 'bumps-baked';

/** Integer lattice hash to [-1, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}

const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1]: smooth trilinear blend of hashed lattice corners. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const tx = smooth(x - fx);
  const ty = smooth(y - fy);
  const tz = smooth(z - fz);
  const ix = fx | 0;
  const iy = fy | 0;
  const iz = fz | 0;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 1, 0), c(1, 1, 0), tx), ty),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), ty),
    tz,
  );
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
  let total = 0;
  for (let o = 0; o < octaves; o++) total += 0.5 ** o;
  return (x, y, z) => {
    let h = 0;
    for (let o = 0; o < octaves; o++) {
      const frequency = 2 ** o / base;
      h += 0.5 ** o * valueNoise3(x * frequency + 11.3 * o, y * frequency - 7.1 * o, z * frequency + 3.7 * o, seed + o);
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

export function samplerFor(id: BakedSourceId, layout: BakeLayout): HeightSampler {
  return id === 'noise' ? noiseSampler(layout) : bakedBumpsSampler(layout);
}
