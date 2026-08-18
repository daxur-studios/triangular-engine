import { Vec3d } from '../math/vec3';

/** The LOD-independent surface value at one body-fixed direction. */
export interface ISurfaceSample {
  elevationM: number;
}

/**
 * Biome identity at one body-fixed direction. A body with no biomes reports
 * `dominantBiomeIndex: -1` and an empty `weights` array.
 */
export interface IBiomeSample {
  dominantBiomeIndex: number;
  weights: readonly number[];
}

/**
 * Compiled surface query used by mesh generation without repeatedly
 * interpreting terrain definitions or allocating per batch element.
 */
export interface ISurfaceSampler {
  readonly minElevationM: number;
  readonly maxElevationM: number;

  sample(bodyFixedDirection: Vec3d): ISurfaceSample;

  /**
   * Samples packed xyz f64 directions into one f64 elevation per direction.
   * A supplied output buffer is reused and must have exactly directions/3 items.
   */
  sampleBatch(
    bodyFixedDirections: Float64Array,
    elevationsM?: Float64Array,
  ): Float64Array;

  sampleBiome(bodyFixedDirection: Vec3d): IBiomeSample;

  /**
   * Dominant biome index per direction (argmax weight, ties -> lowest index).
   * A body with no biomes reports `0xffff` (65535) here, not `-1`: the output
   * is a `Uint16Array` and cannot represent `-1`. This intentionally differs
   * from the scalar `sampleBiome`, which returns `-1` for the same case, so
   * callers that switch between the two paths must special-case the sentinel.
   * A supplied output buffer is reused and must have exactly directions/3 items.
   */
  sampleDominantBiomeBatch(
    bodyFixedDirections: Float64Array,
    dominantBiomeIndices?: Uint16Array,
  ): Uint16Array;
}
