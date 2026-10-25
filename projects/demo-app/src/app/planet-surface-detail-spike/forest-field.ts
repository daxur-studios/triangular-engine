import { RUNWAY_APRON_M, runwayDistanceM, runwayFrame, type IRunwaySite, type Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063) Q1/Q3: a forest as a continuous density field. Pure and framework-free. The CPU (instance
 * scatter, worker) and the GPU (`forest-layer.ts`, TSL) evaluate the same function: an integer-hash value noise on
 * body-fixed metres, so a tree is placed exactly where the material layer says there is canopy. Nothing is stored.
 *
 * Every number the GPU twin must repeat lives in this file: change a constant here and the layer follows.
 */

export const FOREST_TREE_HEIGHT_M = 22;
/** Crown width of one placeholder tree, metres. */
export const FOREST_CROWN_WIDTH_M = 12;
/** Grid cell of the instance scatter: at most one tree per cell, so a solid stand is a tree every 12 m. */
export const FOREST_SPACING_M = 12;
/**
 * Share of the ground a solid stand's crowns cover (area of one crown over the area of its cell). The far form's
 * canopy cover is this, so both forms show the same aggregate albedo: the layer is derived from the instance
 * parameters, not tuned by eye.
 */
export const FOREST_CANOPY_COVER = Math.min(0.9, (Math.PI * (FOREST_CROWN_WIDTH_M / 2) ** 2) / FOREST_SPACING_M ** 2);
/** Lattice cell size (metres) and weight of each noise octave: regions, stands, patchy edges. */
export const FOREST_OCTAVES: readonly { readonly cellM: number; readonly weight: number }[] = [
  { cellM: 6000, weight: 0.55 },
  { cellM: 1500, weight: 0.3 },
  { cellM: 120, weight: 0.15 },
];
/** The noise value where forest starts and where it is solid. */
export const FOREST_EDGE: readonly [number, number] = [0.45, 0.62];
/** Forest lives between these heights above the datum: coast to tree line (smoothstep both ends). */
export const FOREST_COAST_M: readonly [number, number] = [5, 40];
export const FOREST_TREELINE_M: readonly [number, number] = [1800, 2600];
/** Trees are cleared from the runway rectangle out to this distance (metres), fully clear inside the first. */
export const FOREST_CLEARANCE_M: readonly [number, number] = [RUNWAY_APRON_M, RUNWAY_APRON_M + 50];

/** One pixel spans about this fraction of the viewing distance (1080p, 60° vertical field of view). */
export const PIXEL_PER_DISTANCE = 0.001;
/** A tree is individually visible while its crown covers at least this many pixels... */
export const FADE_START_PIXELS = 12;
/** ...and is gone into the field at this many. */
export const FADE_END_PIXELS = 4;

/** Instances fade out and the layer fades in over this camera distance band, from the tree's crown width. */
export function forestFadeBand(crownWidthM: number = FOREST_CROWN_WIDTH_M): { startM: number; endM: number } {
  return {
    startM: crownWidthM / (FADE_START_PIXELS * PIXEL_PER_DISTANCE),
    endM: crownWidthM / (FADE_END_PIXELS * PIXEL_PER_DISTANCE),
  };
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** 32-bit integer hash of a lattice point, to [0, 1). The TSL twin repeats these constants and operations. */
export function forestHash(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/** Trilinear value noise in [0, 1] on a lattice of `cellM`. `octave` offsets the lattice so octaves do not align. */
export function forestNoise(x: number, y: number, z: number, cellM: number, octave: number): number {
  const o = octave * 1013.7;
  const px = (x + o) / cellM;
  const py = (y + o * 0.7) / cellM;
  const pz = (z + o * 1.3) / cellM;
  const fx = Math.floor(px);
  const fy = Math.floor(py);
  const fz = Math.floor(pz);
  const tx = smooth(0, 1, px - fx);
  const ty = smooth(0, 1, py - fy);
  const tz = smooth(0, 1, pz - fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (dx: number, dy: number, dz: number) => forestHash(fx + dx, fy + dy, fz + dz);
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), tx), lerp(corner(0, 1, 0), corner(1, 1, 0), tx), ty),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), tx), lerp(corner(0, 1, 1), corner(1, 1, 1), tx), ty),
    tz,
  );
}

/** Forest density in [0, 1] at a body-fixed point (metres), at `heightM` above the datum. No runway clearance. */
export function forestFieldDensity(x: number, y: number, z: number, heightM: number): number {
  let n = 0;
  FOREST_OCTAVES.forEach((octave, i) => {
    n += octave.weight * forestNoise(x, y, z, octave.cellM, i);
  });
  const land = smooth(FOREST_COAST_M[0], FOREST_COAST_M[1], heightM) * (1 - smooth(FOREST_TREELINE_M[0], FOREST_TREELINE_M[1], heightM));
  return smooth(FOREST_EDGE[0], FOREST_EDGE[1], n) * land;
}

/** 0 on the runway and its apron, 1 beyond the clearance. */
export function forestClearance(site: IRunwaySite | null, direction: Vec3, radiusM: number): number {
  if (!site) return 1;
  return smooth(FOREST_CLEARANCE_M[0], FOREST_CLEARANCE_M[1], runwayDistanceM(site, direction, radiusM));
}

export interface IForestScatterOptions {
  /** Unit direction of the scatter centre. */
  readonly centre: Vec3;
  readonly radiusM: number;
  /** Radius of the scattered disc, metres. */
  readonly areaRadiusM: number;
  /** Grid cell size, metres: at most one tree per cell. */
  readonly spacingM: number;
  readonly densityScale: number;
  readonly site: IRunwaySite | null;
  /** Ground height above the datum at a direction (stamp included), `null` for water or ice. */
  heightAt(direction: Vec3): number | null;
}

/** Floats per instance in {@link scatterForest}'s result: x, y, z (body-fixed metres from the centre), a random 0..1. */
export const SCATTER_STRIDE = 4;

/**
 * Instances for the forest near `centre`: a jittered grid, a tree per cell with probability equal to the field's
 * density there (times `densityScale`), at the ground height. Positions are body-fixed metres relative to the point
 * on the surface under `centre` at height 0, so they stay small in float32.
 */
export function scatterForest(options: IForestScatterOptions): Float32Array {
  const { centre, radiusM, areaRadiusM, spacingM, densityScale, site } = options;
  const { along, across } = runwayFrame(centre, 0);
  const out: number[] = [];
  const cells = Math.ceil(areaRadiusM / spacingM);
  for (let j = -cells; j <= cells; j += 1) {
    for (let i = -cells; i <= cells; i += 1) {
      // Jitter and the keep/discard draw come from the cell's own hash, so the scatter is the same wherever it is cut.
      const a = (i + forestHash(i, j, 11)) * spacingM;
      const b = (j + forestHash(i, j, 23)) * spacingM;
      if (a * a + b * b > areaRadiusM * areaRadiusM) continue;
      const x = centre[0] + (along[0] * a + across[0] * b) / radiusM;
      const y = centre[1] + (along[1] * a + across[1] * b) / radiusM;
      const z = centre[2] + (along[2] * a + across[2] * b) / radiusM;
      const l = Math.hypot(x, y, z);
      const direction: Vec3 = [x / l, y / l, z / l];
      const heightM = options.heightAt(direction);
      if (heightM === null) continue;
      const r = radiusM + heightM;
      const density =
        Math.min(forestFieldDensity(direction[0] * r, direction[1] * r, direction[2] * r, heightM) * densityScale, 1) *
        forestClearance(site, direction, radiusM);
      if (forestHash(i, j, 37) >= density) continue;
      out.push(direction[0] * r - centre[0] * radiusM, direction[1] * r - centre[1] * radiusM, direction[2] * r - centre[2] * radiusM, forestHash(i, j, 51));
    }
  }
  return Float32Array.from(out);
}
