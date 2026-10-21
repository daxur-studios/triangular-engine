import type { Matrix3 } from 'three';
import {
  CANYON_DEPTH, MASK_OFFSETS, PAD_INNER_RAD, PAD_OUTER_RAD, ROCK_AMPLITUDE, ROCK_LATTICE, ROCK_MEAN, OCTAVE_SCALE, STRETCH,
  bottomAltitudeM, fieldFrameMatrices, positiveModulo, topAltitudeM, unitM,
} from './planet-shape-field';
import { NOISE_PERIOD, NOISE_SIZE, NOISE_SLICE_SHIFT, generateNoiseBytes } from './planet-shape-noise';

/**
 * The v2 terrain field in doubles: the TypeScript twin of `planet-shape-field.ts`. Positions are body-relative (metres
 * from the body centre), so bases, physics and queries can ask the question the raymarcher answers: is this point in
 * the drawn ground. The noise reads the same bytes as the GPU texture, through the smooth (four-tap, float weights) path.
 */

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 3D value noise 0..1 at noise coordinates `x, y, z`, reading the RGBA bytes like the shader's smooth path. */
export function valueNoiseCpu(bytes: Uint8Array, x: number, y: number, z: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const pz = Math.floor(z);
  const fx = x - px;
  const fy = y - py;
  const fz = z - pz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const baseX = px + NOISE_SLICE_SHIFT.x * pz;
  const baseY = py + NOISE_SLICE_SHIFT.y * pz;
  const texel = (dx: number, dy: number, channel: number): number => {
    const tx = positiveModulo(baseX + dx, NOISE_SIZE);
    const ty = positiveModulo(baseY + dy, NOISE_SIZE);
    return bytes[(ty * NOISE_SIZE + tx) * 4 + channel] / 255;
  };
  const blend = (channel: number): number => {
    const bottom = texel(0, 0, channel) * (1 - sx) + texel(1, 0, channel) * sx;
    const top = texel(0, 1, channel) * (1 - sx) + texel(1, 1, channel) * sx;
    return bottom * (1 - sy) + top * sy;
  };
  const g = blend(1);
  const r = blend(0);
  return g * (1 - sz) + r * sz;
}

export interface TerrainFieldCpu {
  readonly radiusM: number;
  /** A tenth of the relief, in metres. */
  readonly unit: number;
  /** Canyon mask 0..1 at the body-relative point. */
  canyon(p: readonly [number, number, number]): number;
  /** Rock noise sum 0..0.875; `footprint` (metres, default 0) fades octaves finer than a pixel to their mean. */
  rock(p: readonly [number, number, number], footprint?: number): number;
  /** Signed field in metres (negative inside rock). */
  density(p: readonly [number, number, number], footprint?: number): number;
  isSolid(p: readonly [number, number, number]): boolean;
  /** Altitude above the body sphere (metres) of the outermost surface along the radial `direction` (need not be unit). */
  groundHeightAt(direction: readonly [number, number, number]): number;
}

export function createTerrainFieldCpu(radiusM: number, bytes: Uint8Array = generateNoiseBytes()): TerrainFieldCpu {
  const unit = unitM(radiusM);
  const frames = fieldFrameMatrices(unit);
  const noise = (m: Matrix3, offset: readonly [number, number, number], x: number, y: number, z: number): number => {
    const e = m.elements; // column-major
    return valueNoiseCpu(
      bytes,
      positiveModulo(e[0] * x + e[3] * y + e[6] * z + offset[0], NOISE_PERIOD),
      positiveModulo(e[1] * x + e[4] * y + e[7] * z + offset[1], NOISE_PERIOD),
      positiveModulo(e[2] * x + e[5] * y + e[8] * z + offset[2], NOISE_PERIOD),
    );
  };
  const zero = [0, 0, 0] as const;

  const canyon = (p: readonly [number, number, number]): number => {
    const v = noise(frames.mask[0], MASK_OFFSETS[0], p[0], p[1], p[2]) * 0.66 + noise(frames.mask[1], MASK_OFFSETS[1], p[0], p[1], p[2]) * 0.34;
    const channel = 1 - Math.abs(v * 2 - 1);
    return Math.max(smoothstep(0.74, 0.93, channel), smoothstep(0.66, 0.8, v));
  };

  const rock = (p: readonly [number, number, number], footprint = 0): number => {
    const length = Math.hypot(p[0], p[1], p[2]);
    const altitude = length - radiusM;
    const k = (altitude * (STRETCH - 1)) / length;
    const sx = p[0] + p[0] * k;
    const sy = p[1] + p[1] * k;
    const sz = p[2] + p[2] * k;
    let sum = 0;
    frames.rock.forEach((m, i) => {
      const lattice = unit * (ROCK_LATTICE / STRETCH) / OCTAVE_SCALE ** i;
      const detail = 1 - smoothstep(lattice * 0.25, lattice, footprint);
      sum += (0.5 + (noise(m, zero, sx, sy, sz) - 0.5) * detail) * 0.5 ** (i + 1);
    });
    return sum;
  };

  const density = (p: readonly [number, number, number], footprint = 0): number => {
    const length = Math.hypot(p[0], p[1], p[2]);
    const altitude = length - radiusM;
    const pad = smoothstep(PAD_INNER_RAD, PAD_OUTER_RAD, Math.sqrt(Math.max(0, 2 - (2 * p[2]) / length)));
    const relief = (canyon(p) * CANYON_DEPTH + (rock(p, footprint) - ROCK_MEAN) * ROCK_AMPLITUDE) * unit;
    return altitude + relief * pad;
  };

  const top = topAltitudeM(radiusM);
  const bottom = bottomAltitudeM(radiusM);

  return {
    radiusM,
    unit,
    canyon,
    rock,
    density,
    isSolid: (p) => density(p) <= 0,
    groundHeightAt(direction) {
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      const d: [number, number, number] = [direction[0] / length, direction[1] / length, direction[2] / length];
      const at = (altitude: number): number => {
        const r = radiusM + altitude;
        return density([d[0] * r, d[1] * r, d[2] * r]);
      };
      // March down from the plateau-top sphere in steps finer than the finest rock lattice; the first sign change is the
      // outermost surface. The solid-floor sphere is ground by definition.
      const step = unit * 0.05;
      let outer = top;
      for (let altitude = top; altitude > bottom; altitude -= step) {
        if (at(altitude) <= 0) {
          let lo = altitude;
          let hi = outer;
          for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (at(mid) <= 0) lo = mid;
            else hi = mid;
          }
          return (lo + hi) / 2;
        }
        outer = altitude;
      }
      return bottom;
    },
  };
}
