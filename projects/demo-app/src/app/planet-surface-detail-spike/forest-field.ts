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
 * Share of the ground a solid stand's crowns cover seen from above: the area of the union of the crowns' discs, measured
 * on the scatter itself (`forest-field.spec.ts` re-measures it and fails if it drifts). It is not the sum of the
 * discs over the cell area: jittered crowns overlap, so 12 m crowns on a 12 m grid cover about 0.65, not 0.79. The far
 * form's canopy cover is this, so both forms show the same aggregate albedo.
 */
export const FOREST_CANOPY_COVER = 0.65;
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

/** Hash of a body-fixed lattice cell plus a salt, to [0, 1): one independent draw per `seed` for every cell. */
export function cellHash(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ Math.imul(seed + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/** Floats per instance in {@link scatterCells}'s result: x, y, z (body-fixed metres from the centre), a random 0..1. */
export const SCATTER_STRIDE = 4;

export interface IScatterOptions {
  /** Unit direction of the window centre. The window only selects which cells to emit; it never moves a cell. */
  readonly centre: Vec3;
  readonly radiusM: number;
  /** Radius of the emitted window, metres along the surface. */
  readonly areaRadiusM: number;
  /** Lattice cell size, metres: at most one object per cell. */
  readonly spacingM: number;
  /** Object class: every class draws its own jitter, keep and attribute hashes from this. */
  readonly seed: number;
  /** Keeps the nearest `maxCount` when the window holds more, so a shortfall is lost at the far edge, not along a row. */
  readonly maxCount?: number;
  /** Ground height above the datum at a direction (stamp included), `null` for water or ice. */
  heightAt(direction: Vec3): number | null;
  /** Keep probability in [0, 1] at a ground point: `radius` is the distance from the body centre, `heightM` above the datum. */
  densityAt(direction: Vec3, radius: number, heightM: number): number;
}

/** What {@link scatterCells} found: the instances, and how many cells passed before `maxCount` cut the far ones. */
export interface IScatterResult {
  readonly instances: Float32Array;
  readonly accepted: number;
}

/**
 * Deterministic scatter on a fixed body-fixed lattice. Every cell `(ix, iy, iz)` of `spacingM` metres owns one jittered
 * candidate point; the cells considered are those whose point lies in the one-cell shell just above the datum sphere,
 * so there is one candidate per `spacingM`² of surface. The candidate is projected down to the ground, kept when
 * `densityAt` exceeds the cell's own draw, and given its yaw and size from the cell's own hash. Nothing depends on the
 * camera, the window centre, the request order or the level of detail: a place always holds the same object, which is
 * what colliders and persistence need.
 */
export function scatterCells(options: IScatterOptions): IScatterResult {
  const { centre, radiusM, areaRadiusM, spacingM: S, seed } = options;
  const R = radiusM;
  const a2 = areaRadiusM * areaRadiusM;
  // Iterate the two body axes other than the centre's dominant one; solve the third from the shell.
  const k = Math.abs(centre[0]) >= Math.abs(centre[1]) && Math.abs(centre[0]) >= Math.abs(centre[2]) ? 0 : Math.abs(centre[1]) >= Math.abs(centre[2]) ? 1 : 2;
  const u = (k + 1) % 3;
  const v = (k + 2) % 3;
  const sign = centre[k] >= 0 ? 1 : -1;
  const cell = [0, 0, 0];
  const found: number[] = [];
  const order: number[] = [];
  const iuMin = Math.floor((centre[u] * R - areaRadiusM) / S);
  const iuMax = Math.floor((centre[u] * R + areaRadiusM) / S);
  const ivMin = Math.floor((centre[v] * R - areaRadiusM) / S);
  const ivMax = Math.floor((centre[v] * R + areaRadiusM) / S);
  for (let iu = iuMin; iu <= iuMax; iu += 1) {
    for (let iv = ivMin; iv <= ivMax; iv += 1) {
      // Where along the dominant axis the shell can be for this column of cells (padded for the sphere's slope).
      const pu = (iu + 0.5) * S;
      const pv = (iv + 0.5) * S;
      const rest = pu * pu + pv * pv;
      const innerSq = R * R - rest;
      const outerSq = (R + S) * (R + S) - rest;
      if (outerSq <= 0) continue;
      const a = Math.sqrt(Math.max(innerSq, 0));
      const b = Math.sqrt(outerSq);
      const from = sign > 0 ? a - 2 * S : -b - 2 * S;
      const to = sign > 0 ? b + 2 * S : -a + 2 * S;
      for (let ik = Math.floor(from / S); ik <= Math.floor(to / S); ik += 1) {
        cell[k] = ik;
        cell[u] = iu;
        cell[v] = iv;
        const [cx, cy, cz] = cell;
        const px = (cx + cellHash(cx, cy, cz, seed * 8)) * S;
        const py = (cy + cellHash(cx, cy, cz, seed * 8 + 1)) * S;
        const pz = (cz + cellHash(cx, cy, cz, seed * 8 + 2)) * S;
        const r = Math.hypot(px, py, pz);
        if (r < R || r >= R + S) continue;
        const direction: Vec3 = [px / r, py / r, pz / r];
        const cosine = direction[0] * centre[0] + direction[1] * centre[1] + direction[2] * centre[2];
        const arc = R * Math.acos(Math.min(cosine, 1));
        if (arc * arc > a2) continue;
        const heightM = options.heightAt(direction);
        if (heightM === null) continue;
        const ground = R + heightM;
        const density = options.densityAt(direction, ground, heightM);
        if (cellHash(cx, cy, cz, seed * 8 + 3) >= density) continue;
        found.push(
          direction[0] * ground - centre[0] * R,
          direction[1] * ground - centre[1] * R,
          direction[2] * ground - centre[2] * R,
          cellHash(cx, cy, cz, seed * 8 + 4),
        );
        order.push(arc);
      }
    }
  }
  const accepted = order.length;
  const keep = Math.min(accepted, options.maxCount ?? accepted);
  const sorted = order.map((_, i) => i).sort((p, q) => order[p] - order[q]).slice(0, keep);
  const instances = new Float32Array(keep * SCATTER_STRIDE);
  sorted.forEach((from, to) => {
    for (let c = 0; c < SCATTER_STRIDE; c += 1) instances[to * SCATTER_STRIDE + c] = found[from * SCATTER_STRIDE + c];
  });
  return { instances, accepted };
}

/** Seed of the tree class in {@link scatterCells}. */
export const TREE_SEED = 1;

export interface IForestScatterOptions {
  readonly centre: Vec3;
  readonly radiusM: number;
  readonly areaRadiusM: number;
  readonly spacingM: number;
  readonly densityScale: number;
  readonly site: IRunwaySite | null;
  readonly maxCount?: number;
  heightAt(direction: Vec3): number | null;
}

/** Trees: {@link scatterCells} with the forest density field (times `densityScale`) and the runway clearance. */
export function scatterForest(options: IForestScatterOptions): IScatterResult {
  const { radiusM, densityScale, site } = options;
  return scatterCells({
    ...options,
    seed: TREE_SEED,
    densityAt: (direction, radius, heightM) =>
      Math.min(forestFieldDensity(direction[0] * radius, direction[1] * radius, direction[2] * radius, heightM) * densityScale, 1) *
      forestClearance(site, direction, radiusM),
  });
}
