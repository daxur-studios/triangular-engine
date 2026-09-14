/** CPU picking helpers for the planar (2.5D) cell-planet map. They mirror the clipmap
 * material's height-texture lookup so a click resolves against the same displaced surface
 * the GPU draws, then convert the hit back through the map projection to a planet direction.
 * The canonical surface sampler and cell graph stay authoritative — this module never returns
 * a render tile or chunk id. */

import type { IVec3 } from 'triangular-engine/worldgen';
import type { IMapProjection } from './map-projections';

export interface IPlanarMapBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * A bounded row-major height grid matching a planar surface bake and its height texture.
 * `elevations` values are already in display/world height units (the same units the bake's
 * `heightScale` produces), so `samplePlanarHeight()` returns a world-space Y directly.
 */
export interface IPlanarHeightField {
  readonly width: number;
  readonly height: number;
  readonly elevations: ArrayLike<number>;
  readonly bounds: IPlanarMapBounds;
  /** Lowest sampled elevation, used to bound the ray intersection. */
  readonly minY: number;
  /** Highest sampled elevation, used to bound the ray intersection. */
  readonly maxY: number;
}

export interface IPlanarRay {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

export interface IPlanarSurfaceRayHit {
  /** World-space X of the sampled-surface hit. */
  readonly x: number;
  /** World-space Z of the sampled-surface hit. */
  readonly z: number;
  /** Sampled surface height at the hit, in world units. */
  readonly y: number;
  /** Ray parameter (world distance along the unit direction) at the hit. */
  readonly distance: number;
}

export interface IPlanarSurfaceRayOptions {
  /** Marker step as a fraction of the smaller texel's world size. Defaults to 0.5. */
  readonly stepScale?: number;
  /** Hard cap on marker samples. Defaults to 4096. */
  readonly maxSteps?: number;
  /** Bisection refinements after a crossing. Defaults to 24. */
  readonly bisectionIterations?: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Bilinear height sample reproducing the height texture's `LinearFilter` + `ClampToEdge`
 * sampling. Positions outside the map bounds return `0`, matching the clipmap material's
 * exterior fallback. Uses texel centres (`(u * width) - 0.5`) so it agrees with the texture
 * coordinate convention rather than the bake's vertex-grid convention.
 */
export function samplePlanarHeight(field: IPlanarHeightField, worldX: number, worldZ: number): number {
  const { width, height, bounds, elevations } = field;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  if (width < 1 || height < 1 || spanX <= 0 || spanZ <= 0) return 0;
  const u = (worldX - bounds.minX) / spanX;
  const v = (worldZ - bounds.minZ) / spanZ;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

  const fx = u * width - 0.5;
  const fz = v * height - 0.5;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const cx0 = clamp(x0, 0, width - 1);
  const cx1 = clamp(x0 + 1, 0, width - 1);
  const cz0 = clamp(z0, 0, height - 1);
  const cz1 = clamp(z0 + 1, 0, height - 1);

  const h00 = elevations[cz0 * width + cx0] ?? 0;
  const h10 = elevations[cz0 * width + cx1] ?? 0;
  const h01 = elevations[cz1 * width + cx0] ?? 0;
  const h11 = elevations[cz1 * width + cx1] ?? 0;
  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * tz;
}

/**
 * Intersects a ray with the sampled planar height field by clipping against the field's
 * bounds and marching until the ray drops below the sampled surface, then refining with
 * bisection.
 *
 * Approximation: the intersection uses the fine bake grid only. It does not evaluate the
 * clipmap's per-vertex LOD morph or ring-border blend, so at distances where the GPU renders
 * a coarser (morphed) surface the visible hit can differ by up to that level's linear
 * interpolation error. Near the camera, where the finest level is unmorphed, the hit matches
 * the rendered surface. A ray that starts on or below the sampled surface (camera inside
 * terrain) returns `null`.
 */
export function intersectPlanarHeightField(
  field: IPlanarHeightField,
  ray: IPlanarRay,
  options: IPlanarSurfaceRayOptions = {},
): IPlanarSurfaceRayHit | null {
  const { origin, direction } = ray;
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(directionLength) || directionLength === 0) return null;

  const bounds = field.bounds;
  let tMin = 0;
  let tMax = Infinity;
  const slabs: readonly [number, number, number, number][] = [
    [origin.x, direction.x, bounds.minX, bounds.maxX],
    [origin.y, direction.y, field.minY, field.maxY],
    [origin.z, direction.z, bounds.minZ, bounds.maxZ],
  ];
  for (const [o, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return null;
  }

  const horizontal = Math.hypot(direction.x, direction.z);
  const texelSize = Math.min(
    (bounds.maxX - bounds.minX) / Math.max(1, field.width),
    (bounds.maxZ - bounds.minZ) / Math.max(1, field.height),
  );
  const stepScale = options.stepScale ?? 0.5;
  const maxSteps = Math.max(1, Math.floor(options.maxSteps ?? 4096));
  const bisectionIterations = Math.max(1, Math.floor(options.bisectionIterations ?? 24));
  const spatialStep = Math.max(0.01, texelSize * stepScale);
  const step = horizontal > 1e-6 ? spatialStep / horizontal : spatialStep;

  // A field with a flat height has a degenerate Y slab, so the clipped entry can land exactly
  // on the surface. Treat that as a contact hit rather than "camera started inside terrain".
  const contactTolerance = Math.max(1e-4, spatialStep);
  let previousT = tMin;
  let previousAbove = true;
  let crossingT = Number.NaN;
  let t = tMin;
  for (let i = 0; i <= maxSteps; i++) {
    const pointY = origin.y + direction.y * t;
    const height = samplePlanarHeight(field, origin.x + direction.x * t, origin.z + direction.z * t);
    const above = pointY > height;
    if (i === 0) {
      if (!above) {
        if (Math.abs(pointY - height) <= contactTolerance) {
          return { x: origin.x + direction.x * t, z: origin.z + direction.z * t, y: height, distance: t };
        }
        return null;
      }
      previousAbove = true;
    } else if (previousAbove && !above) {
      crossingT = t;
      break;
    }
    previousT = t;
    previousAbove = above;
    if (t >= tMax) break;
    t = Math.min(t + step, tMax);
  }
  if (Number.isNaN(crossingT)) return null;

  let tAbove = previousT;
  let tBelow = crossingT;
  for (let i = 0; i < bisectionIterations; i++) {
    const mid = (tAbove + tBelow) * 0.5;
    const above =
      origin.y + direction.y * mid >
      samplePlanarHeight(field, origin.x + direction.x * mid, origin.z + direction.z * mid);
    if (above) tAbove = mid;
    else tBelow = mid;
  }

  const x = origin.x + direction.x * tBelow;
  const z = origin.z + direction.z * tBelow;
  return { x, z, y: samplePlanarHeight(field, x, z), distance: tBelow };
}

/** Inverse of the bake's planar -> planet mapping: world XZ -> unit-sphere direction through
 * the selected projection. Returns `null` outside a non-rectangular projection's footprint. */
export function mapXZToPlanetDirection(
  projection: IMapProjection,
  field: IPlanarHeightField,
  worldX: number,
  worldZ: number,
): IVec3 | null {
  const bounds = field.bounds;
  const u = (worldX - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (worldZ - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const lonLat = projection.unproject(u * field.width, v * field.height, field.width, field.height);
  if (!lonLat) return null;
  const cosLatitude = Math.cos(lonLat.lat);
  return {
    x: cosLatitude * Math.cos(lonLat.lon),
    y: Math.sin(lonLat.lat),
    z: cosLatitude * Math.sin(lonLat.lon),
  };
}

/** Forward bake mapping: planet direction -> world XZ, matching the shader's texture lookup. */
export function mapPlanetDirectionToMapXZ(
  projection: IMapProjection,
  field: IPlanarHeightField,
  direction: IVec3,
): { x: number; z: number } {
  const lon = Math.atan2(direction.z, direction.x);
  const lat = Math.asin(clamp(direction.y, -1, 1));
  const canvas = projection.project(lon, lat, field.width, field.height);
  const bounds = field.bounds;
  return {
    x: bounds.minX + (canvas.x / field.width) * (bounds.maxX - bounds.minX),
    z: bounds.minZ + (canvas.y / field.height) * (bounds.maxZ - bounds.minZ),
  };
}
