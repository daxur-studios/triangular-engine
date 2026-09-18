import { IVec3 } from 'triangular-engine/worldgen';

/**
 * Orthonormal frame used to project sphere directions into map longitude/latitude. When dynamic
 * tracking is off, consumers pass `IDENTITY_PROJECTION_BASIS` (or omit the basis) and the projected
 * longitude equals the true geographic longitude the CPU-baked flat positions were built from.
 */
export interface IProjectionBasis {
  readonly forward: IVec3;
  readonly up: IVec3;
  readonly right: IVec3;
}

/** `forward = +Z`, `right = +X`, `up = +Y` - the static-map frame, matching `atan2(x, z)` longitude. */
export const IDENTITY_PROJECTION_BASIS: IProjectionBasis = {
  forward: { x: 0, y: 0, z: 1 },
  up: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
};

/**
 * Projected longitude of a sphere direction in the given frame, in `(-pi, pi]`. This is the single
 * source of truth for "which side of the antimeridian is this vertex on" across CPU and GPU.
 */
export function projectedLongitude(
  dir: IVec3,
  basis: IProjectionBasis = IDENTITY_PROJECTION_BASIS,
): number {
  const dotFwd =
    dir.x * basis.forward.x + dir.y * basis.forward.y + dir.z * basis.forward.z;
  const dotRight =
    dir.x * basis.right.x + dir.y * basis.right.y + dir.z * basis.right.z;
  return Math.atan2(dotRight, dotFwd);
}

/**
 * True when the edge `dirA -> dirB` crosses the antimeridian branch cut, i.e. the two projected
 * longitudes sit on opposite sides of the `+/-pi` seam. Adjacent Voronoi corners are always far
 * closer than `pi` apart on the sphere, so any projected span greater than `pi` proves a crossing.
 */
export function edgeCrossesAntimeridian(
  dirA: IVec3,
  dirB: IVec3,
  basis: IProjectionBasis = IDENTITY_PROJECTION_BASIS,
): boolean {
  return (
    Math.abs(
      projectedLongitude(dirA, basis) - projectedLongitude(dirB, basis),
    ) > Math.PI
  );
}

/**
 * True when any edge of the triangle `(d0, d1, d2)` crosses the antimeridian. Filled primitives
 * (terrain triangles, cell overlay fans) cannot be CPU-split as cheaply as line edges, so they rely
 * on this predicate to cull the whole primitive rather than stretch it across the map.
 */
export function triangleCrossesAntimeridian(
  d0: IVec3,
  d1: IVec3,
  d2: IVec3,
  basis: IProjectionBasis = IDENTITY_PROJECTION_BASIS,
): boolean {
  const l0 = projectedLongitude(d0, basis);
  const l1 = projectedLongitude(d1, basis);
  const l2 = projectedLongitude(d2, basis);
  return (
    Math.abs(l0 - l1) > Math.PI ||
    Math.abs(l0 - l2) > Math.PI ||
    Math.abs(l1 - l2) > Math.PI
  );
}

/**
 * GLSL definitions shared by every morph material that culls seam-spanning primitives. Inject into a
 * vertex shader before `main()` and call `seamProjectedLon` / `seamEdgeCrosses` /
 * `seamTriangleCrosses`. Keeping the math here means a new overlay cannot silently reimplement (and
 * get wrong) the seam test.
 */
export const SEAM_GLSL_FUNCTIONS = /* glsl */ `
  float seamProjectedLon(vec3 dir, vec3 forward, vec3 right) {
    return atan(dot(dir, right), dot(dir, forward));
  }

  bool seamEdgeCrosses(vec3 a, vec3 b, vec3 forward, vec3 right) {
    return abs(seamProjectedLon(a, forward, right) - seamProjectedLon(b, forward, right)) > 3.141592653589793;
  }

  bool seamTriangleCrosses(vec3 d0, vec3 d1, vec3 d2, vec3 forward, vec3 right) {
    return seamEdgeCrosses(d0, d1, forward, right) ||
           seamEdgeCrosses(d0, d2, forward, right) ||
           seamEdgeCrosses(d1, d2, forward, right);
  }
`;
