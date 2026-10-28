import { PIXEL_PER_DISTANCE, cellHash } from './forest-field';
import { MIN_SUN_TAN } from './forest-shading';
import { RUNWAY_APRON_M, RUNWAY_LENGTH_M, RUNWAY_WIDTH_M, type IRunwaySite, type Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063) third object class: test buildings, boxes of 50 to 200 m in footprint and height around the
 * runway. Unlike trees and rocks they are a short placed list, not a lattice scatter: a few dozen seeded boxes in the
 * runway's tangent frame, axis-aligned with it. Meshes up close; beyond the mesh band the material draws the roof
 * footprint and a flat ground shadow (the footprint swept away from the sun by `height / tan(elevation)`), with no
 * march; under about a pixel the far form is gone. Pure and framework-free: `building-layer.ts` is the TSL twin.
 */

export const BUILDING_SEED = 3;
/** How many candidates are drawn; the ones that fail a constraint are dropped, so the count is "a few dozen". */
export const BUILDING_CANDIDATES = 60;
export const BUILDING_SIZE_RANGE_M: readonly [number, number] = [50, 200];
export const BUILDING_HEIGHT_RANGE_M: readonly [number, number] = [50, 200];
/** Placement ring around the runway centre, metres in the tangent plane. */
export const BUILDING_RING_M: readonly [number, number] = [500, 3200];
/** Clear ground kept between a footprint and the runway's apron, and between two footprints. */
export const BUILDING_RUNWAY_GAP_M = 150;
export const BUILDING_GAP_M = 40;
/** Trees and rocks are kept this far off a footprint (a crown radius), so no instance stands in a wall. */
export const BUILDING_CLEARANCE_M = 8;
/** The box sinks this far below its ground point, so a slope never shows a gap under a wall. */
export const BUILDING_SINK_M = 10;
/** Floats per building in the worker's reply and the mesh buffer: x, y, z (offset from the site centre at height 0), yaw draw, a, b, half x, half y, height, tone draw. */
export const BUILDING_STRIDE = 10;

/** One box, in the runway's tangent frame (`a` along, `b` across, metres from the site centre). */
export interface IBuilding {
  readonly a: number;
  readonly b: number;
  /** Half extents along and across. */
  readonly hx: number;
  readonly hy: number;
  readonly heightM: number;
  /** Roof tone draw, 0..1. */
  readonly tone: number;
}

export interface IBuildingBands {
  /** The meshes dissolve out over `meshStartM`..`meshEndM` while the roof footprint dissolves in. */
  readonly meshStartM: number;
  readonly meshEndM: number;
}

/** Meshes up to about 4 km, then the footprint form. */
export function buildingBands(): IBuildingBands {
  return { meshStartM: 3000, meshEndM: 4000 };
}

/** Where one building's far form is gone: from 2 px to 1 px of its smallest footprint side (1 px = 0.001 x distance). */
export function buildingFarBand(building: Pick<IBuilding, 'hx' | 'hy'>): { startM: number; endM: number } {
  const side = 2 * Math.min(building.hx, building.hy);
  return { startM: side / (2 * PIXEL_PER_DISTANCE), endM: side / PIXEL_PER_DISTANCE };
}

/** Roof tone multiplier from the draw: concrete greys of 0.8 to 1.2 x the roof albedo. */
export const buildingTone = (draw: number): number => 0.8 + draw * 0.4;

const lerp = (range: readonly [number, number], t: number): number => range[0] + (range[1] - range[0]) * t;

/** Distance outside an axis-aligned box of half extents (hx, hy) at (a, b), negative inside. */
export function boxDistance(a: number, b: number, hx: number, hy: number): number {
  const qx = Math.abs(a) - hx;
  const qy = Math.abs(b) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/**
 * The seeded building list around a runway site. Candidates are drawn from `cellHash` on the candidate index with
 * {@link BUILDING_SEED}; a candidate is dropped when its footprint comes within {@link BUILDING_RUNWAY_GAP_M} of the
 * apron, within {@link BUILDING_GAP_M} of an earlier building, or (with `heightAt`) over water at any corner.
 */
export function placeBuildings(site: IRunwaySite, radiusM: number, heightAt?: (direction: Vec3) => number | null): IBuilding[] {
  const seed = BUILDING_SEED * 8;
  const placed: IBuilding[] = [];
  for (let i = 0; i < BUILDING_CANDIDATES; i += 1) {
    const draw = (k: number): number => cellHash(i, 0, 0, seed + k);
    const angle = draw(0) * Math.PI * 2;
    // Area-uniform in the ring.
    const r = Math.sqrt(lerp([BUILDING_RING_M[0] ** 2, BUILDING_RING_M[1] ** 2], draw(1)));
    const building: IBuilding = {
      a: Math.cos(angle) * r,
      b: Math.sin(angle) * r,
      hx: lerp(BUILDING_SIZE_RANGE_M, draw(2)) / 2,
      hy: lerp(BUILDING_SIZE_RANGE_M, draw(3)) / 2,
      heightM: lerp(BUILDING_HEIGHT_RANGE_M, draw(4)),
      tone: draw(5),
    };
    // Gap to the apron rectangle, both boxes axis-aligned in the same frame.
    const apronX = RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M;
    const apronY = RUNWAY_WIDTH_M / 2 + RUNWAY_APRON_M;
    if (boxDistance(building.a, building.b, apronX + building.hx, apronY + building.hy) < BUILDING_RUNWAY_GAP_M) continue;
    if (placed.some((o) => boxDistance(building.a - o.a, building.b - o.b, building.hx + o.hx, building.hy + o.hy) < BUILDING_GAP_M)) continue;
    if (heightAt) {
      const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => siteDirection(site, radiusM, building.a + sx * building.hx, building.b + sy * building.hy)));
      if (corners.some((c) => heightAt(c) === null)) continue;
    }
    placed.push(building);
  }
  return placed;
}

/** Unit direction of the tangent-plane point (a, b) of a site. */
export function siteDirection(site: IRunwaySite, radiusM: number, a: number, b: number): Vec3 {
  const x = site.centre[0] + (site.along[0] * a + site.across[0] * b) / radiusM;
  const y = site.centre[1] + (site.along[1] * a + site.across[1] * b) / radiusM;
  const z = site.centre[2] + (site.along[2] * a + site.across[2] * b) / radiusM;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** 0 on a footprint and within {@link BUILDING_CLEARANCE_M} of it, 1 beyond: multiplies the tree and rock densities. */
export function buildingClearance(buildings: readonly IBuilding[], site: IRunwaySite | null, direction: Vec3, radiusM: number): number {
  if (!site || buildings.length === 0) return 1;
  const a = (direction[0] * site.along[0] + direction[1] * site.along[1] + direction[2] * site.along[2]) * radiusM;
  const b = (direction[0] * site.across[0] + direction[1] * site.across[1] + direction[2] * site.across[2]) * radiusM;
  for (const o of buildings) if (boxDistance(a - o.a, b - o.b, o.hx, o.hy) < BUILDING_CLEARANCE_M) return 0;
  return 1;
}

/**
 * Where a building's roof edge lands on flat ground, relative to its base, in the site frame: away from the sun by
 * `height / tan(elevation)`. `sunA` and `sunB` are the sun direction's along and across components, `sinElevation`
 * its up component; `tan` is floored at {@link MIN_SUN_TAN} like the trees' shadows.
 */
export function footprintShadowOffset(heightM: number, sunA: number, sunB: number, sinElevation: number): [number, number] {
  const cos = Math.hypot(sunA, sunB);
  if (cos < 1e-9) return [0, 0];
  const length = heightM / Math.max(sinElevation / cos, MIN_SUN_TAN);
  return [(-sunA / cos) * length, (-sunB / cos) * length];
}

/**
 * Signed distance (metres, negative inside) from (a, b) to a building's shadow: the convex hull of its footprint and
 * the footprint moved by `offset`. The hull's edges have the box's four normals plus the two normals across the
 * offset, and its support along a normal n is `hx|n.x| + hy|n.y| + max(offset . n, 0)`; the distance is the largest
 * plane distance, exact inside and on the edges, a slight underestimate past a corner. (a, b) is relative to the
 * building's centre.
 */
export function footprintShadowDistance(a: number, b: number, hx: number, hy: number, offset: readonly [number, number]): number {
  const length = Math.hypot(offset[0], offset[1]);
  const normals: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  if (length > 1e-9) {
    const nx = -offset[1] / length;
    const ny = offset[0] / length;
    normals.push([nx, ny], [-nx, -ny]);
  }
  let d = -Infinity;
  for (const [nx, ny] of normals) {
    const support = hx * Math.abs(nx) + hy * Math.abs(ny) + Math.max(offset[0] * nx + offset[1] * ny, 0);
    d = Math.max(d, a * nx + b * ny - support);
  }
  return d;
}

/**
 * The mesh buffer for `buildings`: per building, the ground point under its centre as an offset from the site
 * centre at height 0 (body-fixed metres, like the scatter's instances), then its yaw draw (always 0: aligned with
 * the runway), the tangent position, half extents, height and tone draw. `heightAt` gives the ground; null ground
 * is taken as the site's plateau.
 */
export function buildingInstances(buildings: readonly IBuilding[], site: IRunwaySite, radiusM: number, heightAt: (direction: Vec3) => number | null): Float32Array {
  const out = new Float32Array(buildings.length * BUILDING_STRIDE);
  buildings.forEach((o, i) => {
    const direction = siteDirection(site, radiusM, o.a, o.b);
    // The lowest corner, so the sunk box covers the slope.
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => heightAt(siteDirection(site, radiusM, o.a + sx * o.hx, o.b + sy * o.hy)) ?? site.heightM));
    const ground = radiusM + Math.min(...corners, heightAt(direction) ?? site.heightM);
    out.set(
      [
        direction[0] * ground - site.centre[0] * radiusM,
        direction[1] * ground - site.centre[1] * radiusM,
        direction[2] * ground - site.centre[2] * radiusM,
        0,
        o.a,
        o.b,
        o.hx,
        o.hy,
        o.heightM,
        o.tone,
      ],
      i * BUILDING_STRIDE,
    );
  });
  return out;
}

/** Reads {@link buildingInstances}' buffer back into the list (the page gets the worker's list this way). */
export function buildingsFromInstances(data: Float32Array): IBuilding[] {
  const out: IBuilding[] = [];
  for (let o = 0; o + BUILDING_STRIDE <= data.length; o += BUILDING_STRIDE) {
    out.push({ a: data[o + 4], b: data[o + 5], hx: data[o + 6], hy: data[o + 7], heightM: data[o + 8], tone: data[o + 9] });
  }
  return out;
}

/**
 * The mesh records as the batch `SurfaceInstances.setInstances` takes (the same shape as the library lattice's result):
 * offsets from the site centre at height 0, a zero yaw draw (the meshes align with the runway), the box size and the
 * roof tone.
 */
export function buildingBatch(
  data: Float32Array,
  site: IRunwaySite,
  radiusM: number,
): {
  originM: [number, number, number];
  offsetsM: Float32Array;
  yaw01: Float32Array;
  scale: Float32Array;
  sizesM: Float32Array;
  tones: Float32Array;
} {
  const n = Math.floor(data.length / BUILDING_STRIDE);
  const offsetsM = new Float32Array(n * 3);
  const sizesM = new Float32Array(n * 3);
  const tones = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const o = i * BUILDING_STRIDE;
    offsetsM.set([data[o], data[o + 1], data[o + 2]], i * 3);
    sizesM.set([data[o + 6] * 2, data[o + 8] + BUILDING_SINK_M, data[o + 7] * 2], i * 3);
    tones.fill(buildingTone(data[o + 9]), i * 3, i * 3 + 3);
  }
  return {
    originM: [site.centre[0] * radiusM, site.centre[1] * radiusM, site.centre[2] * radiusM],
    offsetsM,
    yaw01: new Float32Array(n),
    scale: new Float32Array(n).fill(1),
    sizesM,
    tones,
  };
}
