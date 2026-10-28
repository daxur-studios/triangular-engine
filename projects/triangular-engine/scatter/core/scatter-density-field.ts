import { hashScatterLattice01 } from './scatter-lattice-hash';

/**
 * A density field shared by placement and the far form: the CPU decides which
 * candidates become instances with {@link evaluateScatterDensityField}, and a
 * surface material draws the same field per pixel with
 * `scatterDensityFieldNode` from `triangular-engine/scatter/tsl`. Both read
 * this one definition, so a constant changes in both forms at once.
 */

/** One octave of value noise: lattice cell size in metres and its weight in the sum. */
export interface IScatterNoiseOctave {
  readonly cellM: number;
  readonly weight: number;
}

/**
 * Smoothstep mask on height above the datum. `rise` is where the field
 * starts and where it is full (for example the coast); `fall` is where it
 * starts to thin and where it is gone (for example the tree line).
 */
export interface IScatterHeightBand {
  readonly rise: readonly [number, number];
  readonly fall?: readonly [number, number];
}

/**
 * Data-only density field: `smoothstep(edge, sum of octaves) × height band`,
 * in [0, 1]. Safe to send to a worker.
 */
export interface IScatterDensityFieldDefinition {
  readonly octaves: readonly IScatterNoiseOctave[];
  /**
   * Index of the first octave's lattice offset (default 0). Give fields that
   * share cell sizes different offsets so their noise does not line up.
   */
  readonly octaveOffset?: number;
  /** Noise value where the field starts and where it is full. */
  readonly edge: readonly [number, number];
  readonly heightBandM?: IScatterHeightBand;
}

/** Clamped Hermite smoothstep, the same as TSL/GLSL `smoothstep`. */
export function scatterSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Trilinear value noise in [0, 1] on a lattice of `cellM` metres, with a
 * smoothstep fade per axis. `octave` offsets the lattice so octaves of the
 * same size do not align. Coordinates are body-fixed metres; at planet scale
 * float32 error is a few centimetres, far below any useful cell size.
 */
export function scatterValueNoise3(x: number, y: number, z: number, cellM: number, octave: number): number {
  const o = octave * 1013.7;
  const px = (x + o) / cellM;
  const py = (y + o * 0.7) / cellM;
  const pz = (z + o * 1.3) / cellM;
  const fx = Math.floor(px);
  const fy = Math.floor(py);
  const fz = Math.floor(pz);
  const tx = scatterSmoothstep(0, 1, px - fx);
  const ty = scatterSmoothstep(0, 1, py - fy);
  const tz = scatterSmoothstep(0, 1, pz - fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (dx: number, dy: number, dz: number) => hashScatterLattice01(fx + dx, fy + dy, fz + dz);
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), tx), lerp(corner(0, 1, 0), corner(1, 1, 0), tx), ty),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), tx), lerp(corner(0, 1, 1), corner(1, 1, 1), tx), ty),
    tz,
  );
}

/** The weighted octave sum of a field, before the edge and height band. */
export function evaluateScatterDensityNoise(
  definition: IScatterDensityFieldDefinition,
  x: number,
  y: number,
  z: number,
): number {
  const offset = definition.octaveOffset ?? 0;
  let n = 0;
  for (let i = 0; i < definition.octaves.length; i++) {
    const octave = definition.octaves[i];
    n += octave.weight * scatterValueNoise3(x, y, z, octave.cellM, offset + i);
  }
  return n;
}

/** The height band's mask in [0, 1] at `heightM` above the datum; 1 without a band. */
export function evaluateScatterHeightBand(band: IScatterHeightBand | undefined, heightM: number): number {
  if (!band) return 1;
  const rise = scatterSmoothstep(band.rise[0], band.rise[1], heightM);
  return band.fall ? rise * (1 - scatterSmoothstep(band.fall[0], band.fall[1], heightM)) : rise;
}

/**
 * Density in [0, 1] at a body-fixed point (metres) at `heightM` above the
 * datum. The CPU half of the contract; `scatterDensityFieldNode` is the TSL
 * half and a spec holds the two within a small maximum difference.
 */
export function evaluateScatterDensityField(
  definition: IScatterDensityFieldDefinition,
  x: number,
  y: number,
  z: number,
  heightM: number,
): number {
  const n = evaluateScatterDensityNoise(definition, x, y, z);
  return (
    scatterSmoothstep(definition.edge[0], definition.edge[1], n) *
    evaluateScatterHeightBand(definition.heightBandM, heightM)
  );
}
