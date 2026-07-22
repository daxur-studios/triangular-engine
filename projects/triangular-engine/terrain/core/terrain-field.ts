import { TerrainVector3 } from './terrain-math';

/** Shape-independent result of evaluating one procedural terrain field point. */
export interface ITerrainFieldSample {
  elevationM: number;
}

/** Compiled procedural terrain independent of its plane, sphere, or cylinder domain. */
export interface ITerrainField {
  readonly minElevationM: number;
  readonly maxElevationM: number;
  sample(fieldPosition: TerrainVector3): ITerrainFieldSample;
  /** Samples packed xyz f64 positions into one f64 elevation per position. */
  sampleBatch(
    fieldPositions: Float64Array,
    elevationsM?: Float64Array,
  ): Float64Array;
}

/** Constant field used for flat surfaces, fixtures, and domain isolation tests. */
export class ConstantTerrainField implements ITerrainField {
  readonly minElevationM: number;
  readonly maxElevationM: number;

  constructor(readonly elevationM = 0) {
    if (!Number.isFinite(elevationM))
      throw new RangeError('Terrain elevation must be finite.');
    this.minElevationM = elevationM;
    this.maxElevationM = elevationM;
  }

  sample(_fieldPosition: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.elevationM };
  }

  sampleBatch(
    fieldPositions: Float64Array,
    elevationsM?: Float64Array,
  ): Float64Array {
    if (fieldPositions.length % 3 !== 0) {
      throw new RangeError(
        'Terrain field positions must contain packed xyz triples.',
      );
    }
    const output = elevationsM ?? new Float64Array(fieldPositions.length / 3);
    if (output.length !== fieldPositions.length / 3) {
      throw new RangeError(
        'Terrain elevation output length must match the field-position count.',
      );
    }
    output.fill(this.elevationM);
    return output;
  }
}
