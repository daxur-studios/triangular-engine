import { WATER_LOD_SPIKE_WAVES, type IWaterWave } from './water-lod-spike-waves';

/**
 * Plan 080 Q5 (W0b): does the wave phase survive float32 on a 600 km sphere with the eye 2 m above the water?
 *
 * On a sphere the waves are plane waves with fixed 3D unit directions, so the phase of a wave at a point p is
 * `k (p . d) + phi - omega t`. At the sphere's surface p is about 6e5 m from the centre, so `k (p . d)` is millions of
 * radians and a float32 holds it to half a radian. Two paths are compared with a double-precision reference:
 *
 * - naive: the global position as float32 (what an absolute-position `heightNode` receives), then the same formula as the
 *   flat spike. Position quantisation alone is 3 to 6 cm; the phase of the shortest wave (0.5 m) is off by tenths of a radian.
 * - anchor: the position relative to the anchor (computed in doubles, then float32), and a per-wave phase offset
 *   `(k (anchor . d) + phi - omega t) mod 2 pi` computed in doubles on the CPU each frame. Only the small relative part
 *   is left for the float32 maths.
 *
 * This file is the pure part: the reference, an emulation of the float32 paths and the sample points. The GPU readback in
 * `water-lod-spike-precision-probe.ts` runs the same two formulas in a compute kernel over the same samples.
 */

/** Phase error limit of the anchor path (plan 080 Q5), radians. */
export const MAX_PHASE_ERROR_RAD = 1e-3;
/** The control must miss the limit by at least this factor, or the check cannot tell the paths apart. */
export const CONTROL_MIN_ERROR_RAD = 0.01;

/** Radius of the sphere the Q5 samples sit on, metres. */
export const PRECISION_RADIUS_M = 600_000;
/** Eye height above the water, metres: sets the distance to the horizon. */
export const PRECISION_EYE_HEIGHT_M = 2;
/** Wave time of the second sample set, seconds (an hour into a session). */
export const PRECISION_LATE_TIME_S = 3600;

const TWO_PI = 2 * Math.PI;

/** A plane wave on the sphere: fixed 3D unit direction, wavenumber, initial phase, angular speed, wavelength. */
export interface ISphereWave {
  readonly dir: readonly [number, number, number];
  readonly k: number;
  readonly phase: number;
  readonly angularSpeed: number;
  readonly wavelengthM: number;
}

/**
 * The spike's wave table with fixed 3D directions: a spherical Fibonacci spread over the whole sphere, so some waves
 * point along every axis and the largest dot products are covered. Wavelengths, phases and speeds come from the table.
 */
export function sphereWaves(waves: readonly IWaterWave[] = WATER_LOD_SPIKE_WAVES): readonly ISphereWave[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return waves.map((wave, i) => {
    const y = 1 - (2 * (i + 0.5)) / waves.length;
    const ring = Math.sqrt(1 - y * y);
    const azimuth = golden * i;
    return {
      dir: [ring * Math.cos(azimuth), y, ring * Math.sin(azimuth)] as const,
      k: TWO_PI / wave.wavelengthM,
      phase: wave.phase,
      angularSpeed: wave.angularSpeed,
      wavelengthM: wave.wavelengthM,
    };
  });
}

/** `angle` wrapped to [-pi, pi]. */
export function wrapAngle(angle: number): number {
  return angle - TWO_PI * Math.round(angle / TWO_PI);
}

/** Smallest angle between two phases, radians (both may be any size). */
export function phaseDifference(a: number, b: number): number {
  return Math.abs(wrapAngle(wrapAngle(a) - wrapAngle(b)));
}

type Vec3 = readonly [number, number, number];

/** Reference phase in doubles, wrapped to [-pi, pi]. */
export function referencePhase(wave: ISphereWave, position: Vec3, timeS: number): number {
  const along = position[0] * wave.dir[0] + position[1] * wave.dir[1] + position[2] * wave.dir[2];
  return wrapAngle(wave.k * along + wave.phase - wave.angularSpeed * timeS);
}

/** The anchor path's per-wave offset, computed in doubles: the phase at the anchor, wrapped to [-pi, pi]. Recomputed every frame (time moves it). */
export function anchorPhaseOffset(wave: ISphereWave, anchor: Vec3, timeS: number): number {
  return referencePhase(wave, anchor, timeS);
}

const f = Math.fround;

/**
 * Emulates the naive path in float32: global position rounded to float32, `dot * k + phase - time * omega`, every
 * operation rounded. A GPU may fuse multiply-adds, so this is an estimate of the error, not the error; the readback measures
 * the real one.
 */
export function naivePhaseF32(wave: ISphereWave, position: Vec3, timeS: number): number {
  const along = f(f(f(f(position[0]) * f(wave.dir[0])) + f(f(position[1]) * f(wave.dir[1]))) + f(f(position[2]) * f(wave.dir[2])));
  return f(f(f(along * f(wave.k)) + f(wave.phase)) - f(f(timeS) * f(wave.angularSpeed)));
}

/** Emulates the anchor path in float32: the relative position as float32, `dot * k + offset`, every operation rounded. */
export function anchorPhaseF32(wave: ISphereWave, relative: Vec3, offset: number): number {
  const along = f(f(f(f(relative[0]) * f(wave.dir[0])) + f(f(relative[1]) * f(wave.dir[1]))) + f(f(relative[2]) * f(wave.dir[2])));
  return f(f(along * f(wave.k)) + f(offset));
}

/** Largest distance from the anchor at which a wave is still evaluated: its vertices are coarser than a quarter wavelength beyond this. */
export function waveRangeM(wavelengthM: number, cellPixels: number, pixelAngle: number): number {
  return wavelengthM / (4 * cellPixels * pixelAngle);
}

/** Distance to the horizon from an eye `eyeHeightM` above a sphere of radius `radiusM`. */
export function horizonDistanceM(radiusM: number, eyeHeightM: number): number {
  return Math.sqrt(2 * radiusM * eyeHeightM + eyeHeightM * eyeHeightM);
}

/** One sample point on the water, in doubles: global position and position relative to the anchor. */
export interface IPrecisionSample {
  readonly global: Vec3;
  readonly relative: Vec3;
  readonly distanceM: number;
}

/** Where the samples sit and which camera they assume. */
export interface IPrecisionSampleOptions {
  readonly radiusM?: number;
  readonly eyeHeightM?: number;
  /** Surface distances from the anchor, metres. Default: 1 m to the horizon (about 1.55 km at 2 m). */
  readonly distancesM?: readonly number[];
  readonly azimuths?: number;
}

/** Unit vector of the anchor: not on an axis, so no coordinate is zero and every component carries rounding. */
export const PRECISION_ANCHOR_DIRECTION: Vec3 = (() => {
  const v = [0.48, 0.64, 0.6];
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length] as const;
})();

/** The anchor position (on the water under the eye), doubles. */
export function precisionAnchor(radiusM = PRECISION_RADIUS_M): Vec3 {
  const d = PRECISION_ANCHOR_DIRECTION;
  return [d[0] * radiusM, d[1] * radiusM, d[2] * radiusM];
}

/**
 * Points on the sphere's surface in rings around the anchor, each ring at a fixed great-circle distance, `azimuths` points
 * per ring. Positions are exact doubles; the relative position is their difference.
 */
export function precisionSamples(options: IPrecisionSampleOptions = {}): readonly IPrecisionSample[] {
  const radiusM = options.radiusM ?? PRECISION_RADIUS_M;
  const horizon = horizonDistanceM(radiusM, options.eyeHeightM ?? PRECISION_EYE_HEIGHT_M);
  const distances = options.distancesM ?? [1, 2, 5, 10, 30, 100, 300, 1000, horizon];
  const azimuths = options.azimuths ?? 8;
  const up = PRECISION_ANCHOR_DIRECTION;
  // Two tangent axes at the anchor.
  const helper: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalise(cross(up, helper));
  const e2 = cross(up, e1);
  const anchor = precisionAnchor(radiusM);
  const samples: IPrecisionSample[] = [];
  for (const distanceM of distances) {
    const angle = distanceM / radiusM;
    for (let a = 0; a < azimuths; a++) {
      const azimuth = (TWO_PI * (a + 0.37)) / azimuths;
      const along: Vec3 = [
        Math.cos(azimuth) * e1[0] + Math.sin(azimuth) * e2[0],
        Math.cos(azimuth) * e1[1] + Math.sin(azimuth) * e2[1],
        Math.cos(azimuth) * e1[2] + Math.sin(azimuth) * e2[2],
      ];
      const direction: Vec3 = [
        Math.cos(angle) * up[0] + Math.sin(angle) * along[0],
        Math.cos(angle) * up[1] + Math.sin(angle) * along[1],
        Math.cos(angle) * up[2] + Math.sin(angle) * along[2],
      ];
      const global: Vec3 = [direction[0] * radiusM, direction[1] * radiusM, direction[2] * radiusM];
      samples.push({ global, relative: [global[0] - anchor[0], global[1] - anchor[1], global[2] - anchor[2]], distanceM });
    }
  }
  return samples;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Phase error of one path over a set of (wave, sample) pairs. */
export interface IPathError {
  readonly maxRad: number;
  readonly rmsRad: number;
  readonly pairs: number;
  /** Wavelength and distance of the worst pair. */
  readonly worstWavelengthM: number;
  readonly worstDistanceM: number;
}

/** Collects the errors of a path pair by pair. */
export class PathErrorAccumulator {
  private max = 0;
  private sumSquares = 0;
  private pairs = 0;
  private worstWavelengthM = 0;
  private worstDistanceM = 0;

  add(errorRad: number, wavelengthM: number, distanceM: number): void {
    this.pairs++;
    this.sumSquares += errorRad * errorRad;
    if (errorRad > this.max) {
      this.max = errorRad;
      this.worstWavelengthM = wavelengthM;
      this.worstDistanceM = distanceM;
    }
  }

  result(): IPathError {
    return {
      maxRad: this.max,
      rmsRad: this.pairs > 0 ? Math.sqrt(this.sumSquares / this.pairs) : 0,
      pairs: this.pairs,
      worstWavelengthM: this.worstWavelengthM,
      worstDistanceM: this.worstDistanceM,
    };
  }
}

/** The pairs a path is judged on: a wave is judged only at the samples within its range (beyond it the vertex filter has dropped the wave). */
export function pairInRange(wave: ISphereWave, sample: IPrecisionSample, rangeScale: { cellPixels: number; pixelAngle: number }): boolean {
  return sample.distanceM <= waveRangeM(wave.wavelengthM, rangeScale.cellPixels, rangeScale.pixelAngle);
}

/** Cell size and pixel angle the ranges assume: the ultra tier at 4K, the farthest a wave is evaluated. */
export const PRECISION_RANGE_SCALE = { cellPixels: 4, pixelAngle: 5e-4 };

/** Per-sample, per-wave output of the GPU kernel: naive phase, anchor phase, sine of the wrapped anchor phase, unused. */
export const PROBE_STRIDE = 4;

/** What the GPU kernel returned for one wave time, compared with the doubles. */
export interface IPrecisionCase {
  readonly timeS: number;
  readonly gpuNaive: IPathError;
  readonly gpuAnchor: IPathError;
  readonly emulatedNaive: IPathError;
  readonly emulatedAnchor: IPathError;
  /** Largest |sin(wrapped anchor phase) - sin(reference)| on the GPU (unit amplitude). Reported, not gated. */
  readonly gpuAnchorSineError: number;
}

/** The whole Q5 result. */
export interface IPrecisionReport {
  readonly backend: string;
  readonly radiusM: number;
  readonly eyeHeightM: number;
  readonly waves: number;
  readonly samples: number;
  readonly cases: readonly IPrecisionCase[];
}

/**
 * Compares the kernel's output (`samples.length * waves.length` entries of {@link PROBE_STRIDE} floats, sample-major)
 * with the double reference at wave time `timeS`, over the in-range pairs.
 */
export function compareProbeOutput(
  waves: readonly ISphereWave[],
  samples: readonly IPrecisionSample[],
  timeS: number,
  output: Float32Array,
): Pick<IPrecisionCase, 'gpuNaive' | 'gpuAnchor' | 'gpuAnchorSineError'> {
  const naive = new PathErrorAccumulator();
  const anchor = new PathErrorAccumulator();
  let sineError = 0;
  for (let s = 0; s < samples.length; s++) {
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w];
      if (!pairInRange(wave, samples[s], PRECISION_RANGE_SCALE)) continue;
      const reference = referencePhase(wave, samples[s].global, timeS);
      const o = (s * waves.length + w) * PROBE_STRIDE;
      naive.add(phaseDifference(output[o], reference), wave.wavelengthM, samples[s].distanceM);
      anchor.add(phaseDifference(output[o + 1], reference), wave.wavelengthM, samples[s].distanceM);
      sineError = Math.max(sineError, Math.abs(output[o + 2] - Math.sin(reference)));
    }
  }
  return { gpuNaive: naive.result(), gpuAnchor: anchor.result(), gpuAnchorSineError: sineError };
}

/** Errors of both float32 emulated paths against the double reference over all waves and in-range samples. */
export function emulatedPrecision(
  waves: readonly ISphereWave[],
  samples: readonly IPrecisionSample[],
  timeS: number,
): { readonly naive: IPathError; readonly anchor: IPathError } {
  const anchor = precisionAnchor();
  const naive = new PathErrorAccumulator();
  const relative = new PathErrorAccumulator();
  for (const wave of waves) {
    const offset = anchorPhaseOffset(wave, anchor, timeS);
    for (const sample of samples) {
      if (!pairInRange(wave, sample, PRECISION_RANGE_SCALE)) continue;
      const reference = referencePhase(wave, sample.global, timeS);
      naive.add(phaseDifference(naivePhaseF32(wave, sample.global, timeS), reference), wave.wavelengthM, sample.distanceM);
      relative.add(phaseDifference(anchorPhaseF32(wave, sample.relative, offset), reference), wave.wavelengthM, sample.distanceM);
    }
  }
  return { naive: naive.result(), anchor: relative.result() };
}
