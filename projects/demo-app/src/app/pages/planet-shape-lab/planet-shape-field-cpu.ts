import type { Matrix3 } from 'three';
import {
  BIOME_EDGE, BIOME_OFFSET, MASK_OFFSETS, MAX_TERRAIN_EDITS, MIN_EDGE_M, ROCK_LATTICE, ROCK_MEAN, OCTAVE_SCALE,
  biomeParams, bottomAltitudeM, fieldFrameMatrices, padEdit, positiveModulo, topAltitudeM, unitM, type TerrainEdit,
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
  /** Biome blend 0 (canyons) .. 1 (rolling hills) at the body-relative point, or the override. */
  biome(p: readonly [number, number, number]): number;
  /** The single biome used everywhere (0..1), or `undefined` for the mask. */
  biomeOverride: number | undefined;
  /** Canyon mask 0..1 at the body-relative point. */
  canyon(p: readonly [number, number, number]): number;
  /** Rock noise sum 0..0.875 under the biome there; `footprint` (metres, default 0) fades octaves finer than a pixel to their mean. */
  rock(p: readonly [number, number, number], footprint?: number): number;
  /** The edits in use, in order; the default is the pad under the poses. */
  readonly edits: readonly TerrainEdit[];
  setEdits(edits: readonly TerrainEdit[]): void;
  /** Signed field in metres (negative inside rock). */
  density(p: readonly [number, number, number], footprint?: number): number;
  isSolid(p: readonly [number, number, number]): boolean;
  /** Altitude above the body sphere (metres) of the outermost surface along the radial `direction` (need not be unit). */
  groundHeightAt(direction: readonly [number, number, number]): number;
}

/** One edit applied to a field value at the body-relative point `p` (altitude `altitude`), as the shader does it. */
export function applyEditCpu(edit: TerrainEdit, value: number, p: readonly [number, number, number], altitude: number): number {
  const edge = Math.max(edit.edgeM, MIN_EDGE_M);
  const rx = p[0] - edit.centre[0];
  const ry = p[1] - edit.centre[1];
  const rz = p[2] - edit.centre[2];
  if (edit.kind === 'carve') {
    const hole = edit.radiusM - Math.hypot(rx, ry, rz);
    const h = Math.min(1, Math.max(0, 0.5 + ((hole - value) * 0.5) / edge));
    return value + (hole - value) * h + edge * h * (1 - h);
  }
  const length = Math.hypot(p[0], p[1], p[2]);
  const along = (rx * p[0] + ry * p[1] + rz * p[2]) / length;
  const horizontal = Math.hypot(rx - (p[0] / length) * along, ry - (p[1] / length) * along, rz - (p[2] / length) * along);
  const weight = 1 - smoothstep(edit.radiusM, edit.radiusM + edge, horizontal);
  const target = edit.kind === 'flatten' ? altitude - (edit.heightM ?? 0) : altitude + (value - altitude) * (edit.strength ?? 0.25);
  return value + (target - value) * weight;
}

export function createTerrainFieldCpu(
  radiusM: number, bytes: Uint8Array = generateNoiseBytes(), initialEdits: readonly TerrainEdit[] = [padEdit(radiusM)],
  biomeOverride?: number,
): TerrainFieldCpu {
  let edits = initialEdits;
  let override = biomeOverride;
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

  const biome = (p: readonly [number, number, number]): number =>
    override ?? smoothstep(BIOME_EDGE[0], BIOME_EDGE[1], noise(frames.biome, BIOME_OFFSET, p[0], p[1], p[2]));

  const rock = (p: readonly [number, number, number], footprint = 0, params = biomeParams(biome(p))): number => {
    const length = Math.hypot(p[0], p[1], p[2]);
    const altitude = length - radiusM;
    const k = (altitude * (params.stretch - 1)) / length;
    const sx = p[0] + p[0] * k;
    const sy = p[1] + p[1] * k;
    const sz = p[2] + p[2] * k;
    let sum = 0;
    frames.rock.forEach((m, i) => {
      const lattice = unit * (ROCK_LATTICE / OCTAVE_SCALE ** i) / params.stretch;
      const detail = (1 - smoothstep(lattice * 0.25, lattice, footprint)) * params.octaveContrast[i];
      sum += (0.5 + (noise(m, zero, sx, sy, sz) - 0.5) * detail) * 0.5 ** (i + 1);
    });
    return sum;
  };

  const density = (p: readonly [number, number, number], footprint = 0): number => {
    const length = Math.hypot(p[0], p[1], p[2]);
    const altitude = length - radiusM;
    const params = biomeParams(biome(p));
    const relief = (canyon(p) * params.canyonDepth + (rock(p, footprint, params) - ROCK_MEAN) * params.rockAmplitude) * unit;
    let value = altitude + relief;
    for (const edit of edits) value = applyEditCpu(edit, value, p, altitude);
    return value;
  };

  const top = topAltitudeM(radiusM);
  const bottom = bottomAltitudeM(radiusM);

  return {
    radiusM,
    unit,
    get edits() { return edits; },
    get biomeOverride() { return override; },
    set biomeOverride(value) { override = value; },
    biome,
    setEdits(next) {
      if (next.length > MAX_TERRAIN_EDITS) throw new Error(`At most ${MAX_TERRAIN_EDITS} terrain edits`);
      edits = next;
    },
    canyon,
    rock: (p, footprint) => rock(p, footprint),
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
