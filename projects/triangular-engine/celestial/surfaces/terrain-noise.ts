/**
 * Internal noise primitives shared by mask compiling and every generator
 * kind. Not part of the library's public API (`public-api.ts` never touches
 * this file) — only `surface-query.ts` and `terrain-generators.ts` import it.
 */
import { INoiseTerrainMaskDef } from './terrain-def';

const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;

/** Shape shared by every def that drives one octave-summed lattice field. */
export interface INoiseLikeParams {
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
}

export function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

export function assertNoiseParameters(definition: INoiseLikeParams): void {
  assertFinite('frequency', definition.frequency);
  assertFinite('lacunarity', definition.lacunarity);
  assertFinite('persistence', definition.persistence);
  if (definition.frequency <= 0 || definition.lacunarity <= 0) {
    throw new RangeError('Noise frequency and lacunarity must be positive.');
  }
  if (!Number.isInteger(definition.octaves) || definition.octaves < 1) {
    throw new RangeError('Noise octaves must be a positive integer.');
  }
  if (definition.persistence < 0) {
    throw new RangeError('Noise persistence cannot be negative.');
  }
}

/** Deterministic hash of one lattice point to a value in `[-1, 1)`. */
export function hashLattice(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  let hash = seed | 0;
  hash = Math.imul(hash ^ x, 0x9e37_79b1);
  hash = Math.imul(hash ^ y, 0x85eb_ca77);
  hash = Math.imul(hash ^ z, 0xc2b2_ae3d);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / UINT32_MAX_PLUS_ONE) * 2 - 1;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function valueNoise3d(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const lowYLowZ = lerp(
    hashLattice(x0, y0, z0, seed),
    hashLattice(x1, y0, z0, seed),
    tx,
  );
  const highYLowZ = lerp(
    hashLattice(x0, y1, z0, seed),
    hashLattice(x1, y1, z0, seed),
    tx,
  );
  const lowYHighZ = lerp(
    hashLattice(x0, y0, z1, seed),
    hashLattice(x1, y0, z1, seed),
    tx,
  );
  const highYHighZ = lerp(
    hashLattice(x0, y1, z1, seed),
    hashLattice(x1, y1, z1, seed),
    tx,
  );
  return lerp(
    lerp(lowYLowZ, highYLowZ, ty),
    lerp(lowYHighZ, highYHighZ, ty),
    tz,
  );
}

/** Persistence-weighted average of octaves, in `[-1, 1]`. */
export function fractalNoise3d(
  x: number,
  y: number,
  z: number,
  definition: INoiseLikeParams,
  seed: number,
): number {
  let frequency = definition.frequency;
  let weight = 1;
  let weightedNoise = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < definition.octaves; octave += 1) {
    weightedNoise +=
      valueNoise3d(x * frequency, y * frequency, z * frequency, seed + octave) *
      weight;
    totalWeight += weight;
    frequency *= definition.lacunarity;
    weight *= definition.persistence;
  }
  return totalWeight > 0 ? weightedNoise / totalWeight : 0;
}

/** Persistence-weighted average of ridged octaves, in `[0, 1]`. */
export function ridgedFractalNoise3d(
  x: number,
  y: number,
  z: number,
  definition: INoiseLikeParams & { ridgeExponent: number },
  seed: number,
): number {
  let frequency = definition.frequency;
  let weight = 1;
  let weightedRidge = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < definition.octaves; octave += 1) {
    const noise = valueNoise3d(
      x * frequency,
      y * frequency,
      z * frequency,
      seed + octave,
    );
    const ridge = Math.pow(1 - Math.abs(noise), definition.ridgeExponent);
    weightedRidge += ridge * weight;
    totalWeight += weight;
    frequency *= definition.lacunarity;
    weight *= definition.persistence;
  }
  return totalWeight > 0 ? weightedRidge / totalWeight : 0;
}

export function smoothstep(
  lower: number,
  upper: number,
  value: number,
): number {
  const unit = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return unit * unit * (3 - 2 * unit);
}

/** A compiled, repeatedly-callable field: a generator layer or a mask weight. */
export interface ICompiledGenerator {
  sample(x: number, y: number, z: number): number;
}

/** Compiles a region mask to a `[0, 1]`-weighted field via smoothstepped noise. */
export function compileMask(
  definition: INoiseTerrainMaskDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('mask lowerThreshold', definition.lowerThreshold);
  assertFinite('mask upperThreshold', definition.upperThreshold);
  if (definition.lowerThreshold >= definition.upperThreshold) {
    throw new RangeError('Mask lowerThreshold must be below upperThreshold.');
  }
  const maskSeed = seed + (definition.seedOffset ?? 0);
  return {
    sample: (x, y, z) =>
      smoothstep(
        definition.lowerThreshold,
        definition.upperThreshold,
        fractalNoise3d(x, y, z, definition, maskSeed),
      ),
  };
}
