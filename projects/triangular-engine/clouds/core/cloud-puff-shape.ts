/** Deterministic PRNG (mulberry32) so a given seed always reproduces the same sequence. */
export function createCloudRandom01(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let hash =
    Math.imul(x, 374_761_393) +
    Math.imul(y, 668_265_263) +
    Math.imul(z, 2_147_483_647);
  hash = Math.imul(hash ^ (hash >>> 13) ^ Math.imul(seed, 1_274_126_177), 1_274_126_177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffff_ffff;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Trilinear-interpolated value noise, seeded and deterministic. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);
  const y0 = lerp(x00, x10, fy);
  const y1 = lerp(x01, x11, fy);
  return lerp(y0, y1, fz) * 2 - 1;
}

/** Fractal Brownian motion over {@link valueNoise3} — a few octaves of value noise summed together. */
export function fbmCloudNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves: number,
): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value +=
      valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 101) *
      amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.02;
  }
  return normalizer > 0 ? value / normalizer : 0;
}

export interface ICloudPuffVariantParams {
  readonly seed: number;
  readonly noiseFrequency: number;
  readonly noiseAmplitude: number;
  readonly octaves: number;
  /** Shifts noise positive so lobes read as puffy bulges rather than a bland dented sphere. */
  readonly lumpBias: number;
}

/** Deterministic shape-variant pool: same `baseSeed` always yields the same set of puff shapes. */
export function createCloudPuffVariantParams(
  count: number,
  baseSeed: number,
): ICloudPuffVariantParams[] {
  const random = createCloudRandom01(baseSeed);
  return Array.from({ length: count }, () => ({
    seed: Math.floor(random() * 0xffff_ffff),
    noiseFrequency: 1.4 + random() * 1.2,
    noiseAmplitude: 0.28 + random() * 0.22,
    octaves: 3,
    lumpBias: 0.15 + random() * 0.15,
  }));
}

/**
 * Radial displacement (roughly [-0.4, 0.6]) for a point on a unit sphere, used to turn a smooth
 * icosphere into a lumpy cloud puff. `directionX/Y/Z` should be a unit vector.
 */
export function sampleCloudPuffDisplacement(
  directionX: number,
  directionY: number,
  directionZ: number,
  params: ICloudPuffVariantParams,
): number {
  const noise = fbmCloudNoise3(
    directionX * params.noiseFrequency,
    directionY * params.noiseFrequency,
    directionZ * params.noiseFrequency,
    params.seed,
    params.octaves,
  );
  return (noise + params.lumpBias) * params.noiseAmplitude;
}
