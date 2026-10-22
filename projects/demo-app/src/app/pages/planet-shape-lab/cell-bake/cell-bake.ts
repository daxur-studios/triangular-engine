/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { Fn, abs, clamp, float, floor, fract, int, ivec2, mix, select, textureLoad } from 'three/tsl';
import { type Biome, type ICellPlanetWorld } from 'triangular-engine/worldgen';

/**
 * Plan 055 Phase 1b: the cell planet as the source of terrain v2's large scale. Every Voronoi cell carries a base
 * height, a biome and a maximum height; they are baked into a cube map so the march and the CPU twin read them with one
 * bilinear lookup (no cell search per step).
 *
 * Layout. Six faces with the convention of `shape-ops/op-index.ts`: face = axis * 2 + (negative ? 1 : 0); u and v are the
 * next two axes over the major component (gnomonic). Faces are stacked in one 2D atlas, each `size = resolution + 2`
 * texels square (a one-texel gutter baked from the neighbouring faces' true directions, so bilinear lookups cross face
 * edges without a seam), `size` wide and `6 * size` tall. A texel holds `[baseHeightM, biome, maxHeightM, 1]` (float32).
 *
 * Blending. Across a cell border each cell's weight falls from 1 at the nearest cell's angle `a0` to 0 at `a0 + width`
 * (smoothstep), then the weights are normalised. On a border two cells have the same angle, so their weights are equal
 * and the value is continuous there; nothing steps.
 */

export interface CellBakeParams {
  /** Texels per face edge (without the gutter). Default 128. */
  readonly resolution?: number;
  /** Border blend width as a share of the mean cell spacing (angular). Default 0.5. */
  readonly blendFraction?: number;
  /** Height of the highest land cell above sea level, metres. Default 3000. */
  readonly landMaxM?: number;
  /** Sea-floor depth is clamped at this many metres below sea level. Default 600. */
  readonly oceanDepthM?: number;
  /** Metres a mountain cell may stand above its base height (its `maxHeightM` headroom). Default 1800. */
  readonly mountainReliefM?: number;
  /** The same for any other land cell. Default 300. */
  readonly otherReliefM?: number;
}

export interface CellData {
  readonly baseHeightM: Float32Array;
  /** 0 = canyons, 1 = hills (`CANYON_BIOME` / `HILLS_BIOME`). */
  readonly biome: Float32Array;
  readonly maxHeightM: Float32Array;
  readonly isMountain: Uint8Array;
}

export interface CellBake {
  readonly resolution: number;
  /** Texels per face edge including the gutter: `resolution + 2`. */
  readonly size: number;
  /** `size * 6 * size` RGBA float32 texels: `[baseHeightM, biome, maxHeightM, 1]`, faces stacked vertically. */
  readonly data: Float32Array;
  readonly blendRadians: number;
  readonly cellCount: number;
}

export interface CellBakeSample {
  readonly baseHeightM: number;
  readonly biome: number;
  readonly maxHeightM: number;
}

const DEFAULTS = { resolution: 128, blendFraction: 0.5, landMaxM: 3000, oceanDepthM: 600, mountainReliefM: 1800, otherReliefM: 300 };

/** Land biomes that stand as mountains (a shape program decides what to build there). */
const MOUNTAIN_BIOMES = new Set<Biome>(['alpine', 'crater_peak', 'shield_volcano', 'tessera_highlands', 'lunar_highlands', 'martian_highlands']);
/** Land biomes read as dry, cut ground; everything else is hills. */
const CANYON_BIOMES = new Set<Biome>(['canyon', 'rift_canyon', 'desert', 'martian_lowlands', 'martian_highlands', 'volcanic_plains', 'cinder_plateau']);

export function isMountainCell(world: ICellPlanetWorld, cellId: number): boolean {
  return world.tectonics.isLand[cellId] === true && MOUNTAIN_BIOMES.has(world.ecology.biome[cellId]);
}

/** Per-cell base height (metres above sea level), biome weight and maximum height. */
export function cellData(world: ICellPlanetWorld, params: CellBakeParams = {}): CellData {
  const p = { ...DEFAULTS, ...params };
  const count = world.graph.cells.length;
  const sea = world.tectonics.seaLevelElevation;
  const span = Math.max(world.eMax - sea, 1e-9);
  const baseHeightM = new Float32Array(count);
  const biome = new Float32Array(count);
  const maxHeightM = new Float32Array(count);
  const isMountain = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const land = world.tectonics.isLand[i] === true;
    const metres = ((world.tectonics.elevation[i] - sea) / span) * p.landMaxM;
    const base = land ? Math.max(metres, 0) : Math.max(metres, -p.oceanDepthM);
    const mountain = isMountainCell(world, i);
    baseHeightM[i] = base;
    biome[i] = CANYON_BIOMES.has(world.ecology.biome[i]) ? 0 : 1;
    maxHeightM[i] = base + (!land ? 0 : mountain ? p.mountainReliefM : p.otherReliefM);
    isMountain[i] = mountain ? 1 : 0;
  }
  return { baseHeightM, biome, maxHeightM, isMountain };
}

function faceAxes(face: number): { axis: number; sign: number } {
  return { axis: face >> 1, sign: face & 1 ? -1 : 1 };
}

/** Unit direction of face `face` at gnomonic (u, v); u and v may leave [-1, 1] a little (the gutter). */
export function cellBakeDirection(face: number, u: number, v: number): [number, number, number] {
  const { axis, sign } = faceAxes(face);
  const d: [number, number, number] = [0, 0, 0];
  d[axis] = sign;
  d[(axis + 1) % 3] = u;
  d[(axis + 2) % 3] = v;
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length];
}

/** Bakes a cell planet into a cube map. Cost is O(texels x cells): about a second at 128 and 2,000 cells. */
export function bakeCellPlanet(world: ICellPlanetWorld, params: CellBakeParams = {}): CellBake {
  const p = { ...DEFAULTS, ...params };
  const cells = world.graph.cells;
  const count = cells.length;
  const data = cellData(world, p);
  const blendRadians = Math.sqrt((4 * Math.PI) / count) * p.blendFraction;
  const res = p.resolution;
  const size = res + 2;
  const out = new Float32Array(size * size * 6 * 4);
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  const cz = new Float64Array(count);
  cells.forEach((cell, i) => {
    cx[i] = cell.center.x;
    cy[i] = cell.center.y;
    cz[i] = cell.center.z;
  });
  const dots = new Float64Array(count);
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const [x, y, z] = cellBakeDirection(face, ((i - 1 + 0.5) / res) * 2 - 1, ((j - 1 + 0.5) / res) * 2 - 1);
        let best = -2;
        for (let c = 0; c < count; c++) {
          const dot = cx[c] * x + cy[c] * y + cz[c] * z;
          dots[c] = dot;
          if (dot > best) best = dot;
        }
        const a0 = Math.acos(Math.min(1, best));
        const reach = Math.cos(Math.min(Math.PI, a0 + blendRadians));
        let sum = 0;
        let height = 0;
        let biome = 0;
        let top = 0;
        for (let c = 0; c < count; c++) {
          if (dots[c] < reach) continue;
          const t = 1 - (Math.acos(Math.min(1, dots[c])) - a0) / blendRadians;
          if (t <= 0) continue;
          const w = t * t * (3 - 2 * t);
          sum += w;
          height += w * data.baseHeightM[c];
          biome += w * data.biome[c];
          top += w * data.maxHeightM[c];
        }
        const at = ((face * size + j) * size + i) * 4;
        out[at] = height / sum;
        out[at + 1] = biome / sum;
        out[at + 2] = top / sum;
        out[at + 3] = 1;
      }
    }
  }
  return { resolution: res, size, data: out, blendRadians, cellCount: count };
}

/**
 * Bilinear lookup of the bake at a direction (need not be normalised). The TSL twin `cellBakeNode` performs exactly
 * these steps with four texel loads, so both agree to float32 rounding.
 */
export function sampleCellBake(bake: CellBake, direction: readonly [number, number, number]): CellBakeSample {
  const { size, resolution: res, data } = bake;
  const ax = Math.abs(direction[0]);
  const ay = Math.abs(direction[1]);
  const az = Math.abs(direction[2]);
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const major = direction[axis];
  const face = axis * 2 + (major < 0 ? 1 : 0);
  const u = direction[(axis + 1) % 3] / Math.abs(major);
  const v = direction[(axis + 2) % 3] / Math.abs(major);
  // Texel centres sit at integer + 0.5 in padded texel space; the face's own texels start at 1.
  const px = ((u + 1) / 2) * res + 1 - 0.5;
  const py = ((v + 1) / 2) * res + 1 - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const clampIndex = (i: number) => Math.min(size - 1, Math.max(0, i));
  const xa = clampIndex(x0);
  const xb = clampIndex(x0 + 1);
  const ya = clampIndex(y0);
  const yb = clampIndex(y0 + 1);
  const channel = (k: number): number => {
    const tap = (x: number, y: number) => data[((face * size + y) * size + x) * 4 + k];
    const lo = tap(xa, ya) * (1 - fx) + tap(xb, ya) * fx;
    const hi = tap(xa, yb) * (1 - fx) + tap(xb, yb) * fx;
    return lo * (1 - fy) + hi * fy;
  };
  return { baseHeightM: channel(0), biome: channel(1), maxHeightM: channel(2) };
}

/** The atlas as a float32 texture for `cellBakeNode` (nearest filtering: the node filters, so no float-filter feature). */
export function createCellBakeTexture(bake: CellBake): DataTexture {
  const texture = new DataTexture(bake.data, bake.size, bake.size * 6, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * TSL twin of `sampleCellBake`: `direction` is a vec3 node (body-relative direction); the result is a vec3 node
 * `(baseHeightM, biome, maxHeightM)`. `resolution` is `bake.resolution`.
 */
export function cellBakeNode(texture: DataTexture, resolution: number, direction: any): any {
  const size = resolution + 2;
  return Fn(([d]: any[]) => {
    const ax = abs(d.x);
    const ay = abs(d.y);
    const az = abs(d.z);
    const isX = ax.greaterThanEqual(ay).and(ax.greaterThanEqual(az));
    const isY = isX.not().and(ay.greaterThanEqual(az));
    const major = select(isX, d.x, select(isY, d.y, d.z));
    const uRaw = select(isX, d.y, select(isY, d.z, d.x));
    const vRaw = select(isX, d.z, select(isY, d.x, d.y));
    const axis = select(isX, int(0), select(isY, int(1), int(2)));
    const face = axis.mul(2).add(select(major.lessThan(0), int(1), int(0)));
    const px = uRaw.div(abs(major)).add(1).mul(0.5 * resolution).add(0.5);
    const py = vRaw.div(abs(major)).add(1).mul(0.5 * resolution).add(0.5);
    const x0 = floor(px);
    const y0 = floor(py);
    const fx = fract(px);
    const fy = fract(py);
    const last = float(size - 1);
    const tap = (x: any, y: any) =>
      textureLoad(texture, ivec2(int(clamp(x, 0, last)), face.mul(size).add(int(clamp(y, 0, last)))), int(0)).xyz;
    const lo = mix(tap(x0, y0), tap(x0.add(1), y0), fx);
    const hi = mix(tap(x0, y0.add(1)), tap(x0.add(1), y0.add(1)), fx);
    return mix(lo, hi, fy);
  })(direction);
}
