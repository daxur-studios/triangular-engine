/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3, type DataTexture } from 'three';
import { abs, float, floor, fract, max, mix, normalize, smoothstep, sqrt, texture, uniform, vec2 } from 'three/tsl';
import { NOISE_PERIOD, NOISE_SLICE_SHIFT } from './planet-shape-noise';

/**
 * Plan 055: the v2 terrain as one definition. A 3D density field,
 * `altitude + pad * unit * (CANYON_DEPTH * canyon + ROCK_AMPLITUDE * (rock - ROCK_MEAN))`, negative inside rock, in metres.
 * The TSL functions here are what the raymarcher draws; `planet-shape-field-cpu.ts` is the same field in doubles, and
 * `planet-shape-field.spec.ts` keeps the two equal. Constants and frame layout live here and are shared by both.
 *
 * Every noise is sampled camera-relative: a frame's matrix (scale and rotation) and origin (the camera's noise
 * coordinates modulo the period) are worked out in doubles on the CPU, so metre-scale noise holds on an Earth-size body.
 */

/** Radius of the flat pad under the poses, as an angle from the +z pole: fully flat inside, full relief outside. */
export const PAD_INNER_RAD = 0.0015;
export const PAD_OUTER_RAD = 0.004;
/** In units (a tenth of the relief): canyon depth, rock-noise amplitude, rock-noise lattice, canyon-mask lattice. */
export const CANYON_DEPTH = 7;
export const ROCK_AMPLITUDE = 3;
export const ROCK_LATTICE = 4;
export const MASK_LATTICE = 30;
/** The rock noise is this much finer vertically: strata and ledges. */
export const STRETCH = 4;
export const ROCK_OCTAVES = 3;
/** Mean of the rock noise sum, so the pad and the plateau line up. */
export const ROCK_MEAN = 0.44;
/** Largest value of the rock noise sum (0.5 + 0.25 + 0.125). */
export const ROCK_MAX = 0.875;
/** Scale ratio between octaves. */
export const OCTAVE_SCALE = 2.02;
/** Octave rotation (orthonormal), applied with the `OCTAVE_SCALE` scale between octaves. */
export const OCTAVE_ROTATION = new Matrix3().set(0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
/** Fixed offsets of the two canyon-mask frames, in noise units. */
export const MASK_OFFSETS: readonly [readonly [number, number, number], readonly [number, number, number]] = [
  [11.3, 4.7, 8.1],
  [3.1, 17.9, 5.3],
];

/** Total relief of the terrain; everything else is in units of a tenth of it. */
export function reliefM(radiusM: number): number {
  return Math.min(radiusM * 0.03, 9000);
}

/** A tenth of the relief, in metres. */
export function unitM(radiusM: number): number {
  return reliefM(radiusM) / 10;
}

/** Altitude of the plateau-top sphere and of the solid-floor sphere above the body sphere, in metres. */
export function topAltitudeM(radiusM: number): number {
  return unitM(radiusM) * ROCK_AMPLITUDE * ROCK_MEAN;
}
export function bottomAltitudeM(radiusM: number): number {
  return -unitM(radiusM) * (CANYON_DEPTH + ROCK_AMPLITUDE * (ROCK_MAX - ROCK_MEAN));
}

/**
 * One camera-relative noise frame: noise coordinates of the camera-relative point `x` are `origin + matrix * x`. The
 * matrix is kept in doubles, and the origin is the camera's coordinates modulo the period.
 */
export interface NoiseFrame {
  readonly matrix: Matrix3;
  readonly offset: Vector3;
  readonly uMatrix: any;
  readonly uOrigin: any;
}

/** What the TSL functions read from a frame: nodes for the matrix and the origin (uniforms, or anything else). */
export type NoiseFrameNodes = Pick<NoiseFrame, 'uMatrix' | 'uOrigin'>;

export function noiseFrame(offset = new Vector3()): NoiseFrame {
  return { matrix: new Matrix3(), offset, uMatrix: uniform(new Matrix3()), uOrigin: uniform(new Vector3()) };
}

/** Matrices of the rock octaves and the two canyon-mask frames for a body whose relief unit is `unit` metres. */
export function fieldFrameMatrices(unit: number): { rock: Matrix3[]; mask: [Matrix3, Matrix3] } {
  const rock: Matrix3[] = [];
  let octave = new Matrix3().multiplyScalar(1 / (ROCK_LATTICE * unit));
  for (let i = 0; i < ROCK_OCTAVES; i++) {
    rock.push(octave);
    octave = new Matrix3().copy(OCTAVE_ROTATION).multiply(octave).multiplyScalar(OCTAVE_SCALE);
  }
  const mask0 = new Matrix3().identity().multiplyScalar(1 / (MASK_LATTICE * unit));
  const mask1 = new Matrix3().copy(OCTAVE_ROTATION).multiplyScalar(OCTAVE_SCALE / (MASK_LATTICE * unit));
  return { rock, mask: [mask0, mask1] };
}

export function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Origin of a frame for a camera at `(x, y, z)`, in doubles, modulo the period. Written into `out`. */
export function noiseOrigin(matrix: Matrix3, offset: Vector3, x: number, y: number, z: number, out = new Vector3()): Vector3 {
  out.set(x, y, z).applyMatrix3(matrix).add(offset);
  return out.set(positiveModulo(out.x, NOISE_PERIOD), positiveModulo(out.y, NOISE_PERIOD), positiveModulo(out.z, NOISE_PERIOD));
}

/**
 * 3D value noise, 0..1. `smooth` blends four texel reads in the shader; otherwise the sampler blends one read, which
 * is cheaper but steps slightly (8-bit filter weights), fine for the march but not for normals.
 */
export function valueNoise(noiseTexture: DataTexture, x: any, smooth: boolean): any {
  const p = floor(x) as any;
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))) as any;
  const base = p.xy.add(vec2(NOISE_SLICE_SHIFT.x, NOISE_SLICE_SHIFT.y).mul(p.z)).add(0.5).toVar();
  let rg: any;
  if (smooth) {
    const tap = (dx: number, dy: number): any => texture(noiseTexture, base.add(vec2(dx, dy)).div(NOISE_PERIOD), float(0));
    rg = mix(mix(tap(0, 0), tap(1, 0), f.x), mix(tap(0, 1), tap(1, 1), f.x), f.y);
  } else {
    rg = texture(noiseTexture, base.add(f.xy).div(NOISE_PERIOD), float(0));
  }
  return mix(rg.y, rg.x, f.z);
}

/** Value noise at the camera-relative point `x` in a frame. */
export function sampleFrame(noiseTexture: DataTexture, frame: NoiseFrameNodes, x: any, smooth: boolean): any {
  return valueNoise(noiseTexture, frame.uOrigin.add(frame.uMatrix.mul(x)), smooth);
}

/** Pad mask 0 (flat) .. 1 (full relief) from the unit up vector. */
export function padAt(up: any): any {
  return smoothstep(PAD_INNER_RAD, PAD_OUTER_RAD, sqrt(max(float(0), float(2).sub(up.z.mul(2)))));
}

/** Canyon mask 0..1: winding channels where the mask noise crosses its middle, and basins where it is high. */
export function canyonAt(noiseTexture: DataTexture, maskFrames: readonly NoiseFrameNodes[], x: any, smooth: boolean): any {
  const v = sampleFrame(noiseTexture, maskFrames[0], x, smooth).mul(0.66)
    .add(sampleFrame(noiseTexture, maskFrames[1], x, smooth).mul(0.34)).toVar();
  const channel = float(1).sub(abs(v.mul(2).sub(1)));
  return max(smoothstep(0.74, 0.93, channel), smoothstep(0.66, 0.8, v));
}

/** Rock noise sum 0..ROCK_MAX; octaves finer than a pixel fade to their mean. `unit` is the relief unit in metres. */
export function rockAt(
  noiseTexture: DataTexture, rockFrames: readonly NoiseFrameNodes[], unit: any,
  x: any, up: any, altitude: any, footprint: any, smooth: boolean,
): any {
  const stretched = x.add(up.mul(altitude.mul(STRETCH - 1))).toVar();
  let sum: any = float(0);
  rockFrames.forEach((frame, i) => {
    const lattice = unit.mul((ROCK_LATTICE / STRETCH) / OCTAVE_SCALE ** i);
    const detail = float(1).sub(smoothstep(lattice.mul(0.25), lattice, footprint));
    sum = sum.add(mix(float(0.5), sampleFrame(noiseTexture, frame, stretched, smooth), detail).mul(0.5 ** (i + 1)));
  });
  return sum;
}

/** Everything `densityAt` reads: the texture, the camera and relief unit as nodes, and the frames. */
export interface FieldNodes {
  readonly noiseTexture: DataTexture;
  /** Camera position in body coordinates (node). */
  readonly camera: any;
  /** Relief unit in metres (node). */
  readonly unit: any;
  readonly rockFrames: readonly NoiseFrameNodes[];
  readonly maskFrames: readonly NoiseFrameNodes[];
}

/** Signed field in metres (negative inside rock), not yet scaled for stepping. `x` is camera-relative. */
export function densityAt(field: FieldNodes, x: any, altitude: any, footprint: any, smooth: boolean): any {
  const up = (normalize(field.camera.add(x)) as any).toVar();
  const rock = rockAt(field.noiseTexture, field.rockFrames, field.unit, x, up, altitude, footprint, smooth);
  const relief = canyonAt(field.noiseTexture, field.maskFrames, x, smooth).mul(CANYON_DEPTH)
    .add(rock.sub(ROCK_MEAN).mul(ROCK_AMPLITUDE)).mul(field.unit);
  return altitude.add(relief.mul(padAt(up)));
}
