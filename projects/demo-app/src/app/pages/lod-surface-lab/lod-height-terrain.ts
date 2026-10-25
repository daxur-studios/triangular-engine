import { buildCellPlanetWorld, findCellNear, type ICellPlanetWorld, type IVec3 } from 'triangular-engine/worldgen';
import { groundFrame, poseView } from './lod-camera';
import type { HeightSampler } from './lod-height-bake';
import type { DomainKind, Vec3 } from './lod-domain';

/**
 * Plan 059 step 3 terrain sources for the baked texture: the cell planet (through the worldgen surface sampler) and a
 * synthetic cliff. Both are pure functions of the base-surface position, like the noise sources, so the bake keeps its
 * seam rule: a point shared by two cube faces has one position and therefore one value.
 */

/**
 * The cell planet as plain data. Functions and worlds do not cross `postMessage`, so the worker gets this and builds the
 * world itself (`buildCellPlanetWorld` is framework-free and worker-safe).
 */
export interface CellPlanetDescription {
  readonly seed: number;
  /** Voronoi cells on the sphere; the world build is seconds at most, so this stays in the low thousands. */
  readonly cellCount: number;
  readonly relaxationIterations: number;
  /** Metres per unit of canonical elevation (the sampler's heights are unitless, sea level at its `seaLevel`). */
  readonly heightScaleM: number;
}

/**
 * Seed 3 at 1000 cells puts the poses' ground point (cube corner direction) on land beside a ridge: the sampler's relative
 * elevation there is +0.43 with +1.45 within a few degrees, so every pose looks at real relief. A spec keeps it on land.
 */
export const CELL_PLANET_SEED = 3;
export const CELL_PLANET_CELLS = 1000;
export const CELL_PLANET_RELAXATION = 2;

/**
 * Metres per canonical elevation unit for a sphere of this radius. The planet's relative elevation runs about -3 to +2.4
 * units, so 1.5 % of the radius gives a few hundred metres on the 10 km sphere (150 m per unit: +360 m peaks, -450 m
 * basins) and the 1200 m cap gives a few kilometres on the 600 km sphere (+2.9 km peaks, -3.7 km basins). The cap keeps
 * the 600 km planet at about half a percent of its radius, the order of a real one's relief; the 10 km toy sphere carries
 * more so the relief is visible at that scale.
 */
export function cellPlanetHeightScaleM(sizeM: number): number {
  return Math.min(0.015 * sizeM, 1200);
}

export function cellPlanetFor(sizeM: number): CellPlanetDescription {
  return { seed: CELL_PLANET_SEED, cellCount: CELL_PLANET_CELLS, relaxationIterations: CELL_PLANET_RELAXATION, heightScaleM: cellPlanetHeightScaleM(sizeM) };
}

/** Checks a description that arrived as untyped data (a worker message); returns it typed or throws. */
export function parseCellPlanet(value: unknown): CellPlanetDescription {
  const d = value as Partial<Record<keyof CellPlanetDescription, unknown>> | null;
  const whole = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min;
  if (!d || !whole(d.seed, 0) || !whole(d.cellCount, 12) || !whole(d.relaxationIterations, 0)
    || typeof d.heightScaleM !== 'number' || !Number.isFinite(d.heightScaleM) || d.heightScaleM <= 0) {
    throw new Error(`Not a cell planet description: ${JSON.stringify(value)}`);
  }
  return { seed: d.seed, cellCount: d.cellCount, relaxationIterations: d.relaxationIterations, heightScaleM: d.heightScaleM };
}

/** What identifies the world itself (the height scale only multiplies its heights, so two scales share one world). */
export const cellPlanetWorldKey = (d: CellPlanetDescription): string => `${d.seed}|${d.cellCount}|${d.relaxationIterations}`;

export interface BuiltCellPlanet {
  readonly world: ICellPlanetWorld;
  /** Wall time of the build that made this world, ms (paid once; later bakes of the same world reuse it). */
  readonly buildMs: number;
}

const worlds = new Map<string, BuiltCellPlanet>();
/** Worlds kept: the 10 km and 600 km spheres use the same one; a third would only be a different seed. */
const WORLD_CACHE = 2;

/** The world of a description, built once per worker/page and kept. */
export function cellPlanetWorld(description: CellPlanetDescription, now: () => number = () => performance.now()): BuiltCellPlanet {
  const key = cellPlanetWorldKey(description);
  const hit = worlds.get(key);
  if (hit) return hit;
  const began = now();
  const world = buildCellPlanetWorld({ cellCount: description.cellCount, seed: description.seed, relaxationIterations: description.relaxationIterations });
  const built = { world, buildMs: now() - began };
  worlds.set(key, built);
  while (worlds.size > WORLD_CACHE) worlds.delete(worlds.keys().next().value as string);
  return built;
}

/**
 * Height of the cell planet's detailed surface in metres: (elevation - sea level) * scale, so the sea is 0 and basins are
 * negative. The position is any vector along the direction (the sampler normalises). A bake visits texels row by row, so
 * the cell found last is the hint for the next (`findCellNear`, then `sampleNear`), which avoids a scan of every cell.
 */
export function cellPlanetSampler(world: ICellPlanetWorld, heightScaleM: number): HeightSampler {
  const direction: IVec3 = { x: 0, y: 0, z: 0 };
  const { graph, sampler } = world;
  let hint = 0;
  return (x, y, z) => {
    direction.x = x;
    direction.y = y;
    direction.z = z;
    hint = findCellNear(graph, direction, hint).id;
    const sample = sampler.sampleNear ? sampler.sampleNear(direction, hint) : sampler.sample(direction);
    return (sample.elevation - sample.seaLevel) * heightScaleM;
  };
}

/** The cliff: a 200 m step whose ramp is a smoothstep over 20 m of ground, 100 m ahead of where the poses stand. */
export const CLIFF_HEIGHT_M = 200;
export const CLIFF_RAMP_M = 20;
export const CLIFF_AHEAD_M = 100;

/** Smoothstep of the signed ground distance `s` across the ramp: 0 below -ramp/2, the full step above +ramp/2. C1, so bilinear and normals stay sane. */
export function cliffHeightAt(s: number): number {
  const t = Math.min(1, Math.max(0, s / CLIFF_RAMP_M + 0.5));
  return CLIFF_HEIGHT_M * t * t * (3 - 2 * t);
}

/**
 * A straight step across the whole body, a function of the 3D point so a bake sees one value per point. It is placed from
 * the poses' ground point and heading: the line is perpendicular to the heading, {@link CLIFF_AHEAD_M} ahead, with the
 * high side away from the camera. On the plane `s` is the distance along the heading. On the sphere the line is a great
 * circle (the points with a zero component along the unit vector `m`, the heading's direction at the line), and `s` is
 * R asin(p . m / |p|), the ground distance from it; the far hemisphere stands 200 m high, continuously (the ramp is the
 * only place the height changes).
 *
 * Meant to look wrong at the baked texture's resolution: the 20 m ramp is a fifth of a texel on the 100 km plane (98 m)
 * and about one on the 10 km sphere (19.5 m). That stretch is what the slope criterion (M2) and vector displacement (M6) answer.
 */
export function cliffSampler(layout: { readonly kind: DomainKind; readonly sizeM: number }): HeightSampler {
  const view = poseView('eye-2m', { kind: layout.kind, sizeM: layout.sizeM, warp: 'equal-angle' });
  const { up, east, north } = groundFrame(layout.kind, view.ground);
  const ch = Math.cos(view.headingRad);
  const sh = Math.sin(view.headingRad);
  const along: Vec3 = [0, 1, 2].map((k) => ch * north[k] + sh * east[k]) as Vec3;
  if (layout.kind === 'plane') {
    const p0: Vec3 = [view.ground[0] + CLIFF_AHEAD_M * along[0], view.ground[1] + CLIFF_AHEAD_M * along[1], view.ground[2] + CLIFF_AHEAD_M * along[2]];
    return (x, y, z) => cliffHeightAt((x - p0[0]) * along[0] + (y - p0[1]) * along[1] + (z - p0[2]) * along[2]);
  }
  const radius = layout.sizeM;
  const ahead: Vec3 = [up[0] * radius + CLIFF_AHEAD_M * along[0], up[1] * radius + CLIFF_AHEAD_M * along[1], up[2] * radius + CLIFF_AHEAD_M * along[2]];
  const aheadLength = Math.hypot(ahead[0], ahead[1], ahead[2]);
  const n0: Vec3 = [ahead[0] / aheadLength, ahead[1] / aheadLength, ahead[2] / aheadLength];
  // Heading direction at the line: `along` with its part along the surface normal there removed.
  const tilt = along[0] * n0[0] + along[1] * n0[1] + along[2] * n0[2];
  const raw: Vec3 = [along[0] - tilt * n0[0], along[1] - tilt * n0[1], along[2] - tilt * n0[2]];
  const rawLength = Math.hypot(raw[0], raw[1], raw[2]);
  const m: Vec3 = [raw[0] / rawLength, raw[1] / rawLength, raw[2] / rawLength];
  return (x, y, z) => {
    const cosine = (x * m[0] + y * m[1] + z * m[2]) / Math.sqrt(x * x + y * y + z * z);
    return cliffHeightAt(radius * Math.asin(Math.min(1, Math.max(-1, cosine))));
  };
}
