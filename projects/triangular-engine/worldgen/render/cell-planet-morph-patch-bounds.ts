import { Box3 } from 'three';
import type { ITerrainPatchBounds } from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, type MapProjectionKind } from './map-projections';

type Range = readonly [number, number];

function containsPeriodic(min: number, max: number, offset: number): boolean {
  return Math.ceil((min - offset) / (2 * Math.PI)) <=
    Math.floor((max - offset) / (2 * Math.PI));
}

function cosineRange(min: number, max: number): Range {
  const a = Math.cos(min);
  const b = Math.cos(max);
  return [
    containsPeriodic(min, max, Math.PI) ? -1 : Math.min(a, b),
    containsPeriodic(min, max, 0) ? 1 : Math.max(a, b),
  ];
}

function product(a: Range, b: Range): Range {
  const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...values), Math.max(...values)];
}

/** Internal conservative bounds for the shader's mix(spherePosition, flatPosition, morph). */
export function populateCellPlanetMorphPatchBounds(
  bounds: ITerrainPatchBounds,
  radius: number,
  morph: number,
  projectionKind: MapProjectionKind,
  reliefMargin: number,
  uvMargin: number,
  target: Box3,
): void {
  const extraU = (bounds.maxU - bounds.minU) * uvMargin;
  const extraV = (bounds.maxV - bounds.minV) * uvMargin;
  const minU = bounds.minU - extraU;
  const maxU = bounds.maxU + extraU;
  const minV = Math.max(-Math.PI / 2, bounds.minV - extraV);
  const maxV = Math.min(Math.PI / 2, bounds.maxV + extraV);
  const cosLat = cosineRange(minV, maxV);
  const sinLon = cosineRange(minU - Math.PI / 2, maxU - Math.PI / 2);
  const cosLon = cosineRange(minU, maxU);
  const radial: Range = [radius - reliefMargin, radius + reliefMargin];
  const sphereX = product(product(cosLat, sinLon), radial);
  const sphereY = product([Math.sin(minV), Math.sin(maxV)], radial);
  const sphereZ = product(product(cosLat, cosLon), radial);

  // Both supported projections have monotone Y. Their X scale is constant
  // (equirectangular) or decreases with |latitude| (Equal Earth), so these
  // endpoints and the latitude nearest the equator contain every X extremum.
  const projection = MAP_PROJECTIONS[projectionKind];
  const width = 2 * Math.PI * radius;
  const height = Math.PI * radius;
  let flatMinX = Infinity;
  let flatMaxX = -Infinity;
  for (const lat of [minV, maxV, Math.max(minV, Math.min(maxV, 0))]) {
    for (const lon of [minU, maxU]) {
      const x = projection.project(lon, lat, width, height).x - width / 2;
      flatMinX = Math.min(flatMinX, x);
      flatMaxX = Math.max(flatMaxX, x);
    }
  }
  const flatMinY = height / 2 - projection.project(0, minV, width, height).y;
  const flatMaxY = height / 2 - projection.project(0, maxV, width, height).y;
  const sphereWeight = 1 - morph;
  // Bounding the two endpoints separately makes the blend conservative even
  // when an intermediate morph's extremum falls between the endpoint extrema.
  target.min.set(
    sphereWeight * sphereX[0] + morph * flatMinX,
    sphereWeight * sphereY[0] + morph * flatMinY,
    sphereWeight * sphereZ[0] - morph * reliefMargin,
  );
  target.max.set(
    sphereWeight * sphereX[1] + morph * flatMaxX,
    sphereWeight * sphereY[1] + morph * flatMaxY,
    sphereWeight * sphereZ[1] + morph * reliefMargin,
  );
  target.expandByScalar(radius * 1e-12); // Roundoff only, not a visibility buffer.
}

/** Maximum direction dot product over a spherical lon/lat rectangle, including wrapping. */
export function maximumCellPlanetPatchDirectionDot(
  bounds: ITerrainPatchBounds,
  cameraLon: number,
  cameraLat: number,
): number {
  const longitudeDot = cosineRange(bounds.minU - cameraLon, bounds.maxU - cameraLon)[1];
  const a = Math.cos(cameraLat) * longitudeDot;
  const b = Math.sin(cameraLat);
  const nearestLat = Math.max(bounds.minV, Math.min(bounds.maxV, Math.atan2(b, a)));
  const dotAt = (lat: number) => a * Math.cos(lat) + b * Math.sin(lat);
  return Math.max(dotAt(bounds.minV), dotAt(bounds.maxV), dotAt(nearestLat));
}

/**
 * Where a patch's surface can be, measured from the planet's centre: a lon/lat
 * rectangle of directions between two radii on the globe, and a box on the
 * flat map. The shader's mix(spherePosition, flatPosition, morph) stays inside
 * the same blend of the two.
 */
export interface ICellPlanetMorphPatchExtents {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  minRadius: number;
  maxRadius: number;
  readonly flatMin: [number, number, number];
  readonly flatMax: [number, number, number];
}

export function createCellPlanetMorphPatchExtents(): ICellPlanetMorphPatchExtents {
  return {
    minU: 0, maxU: 0, minV: 0, maxV: 0, minRadius: 0, maxRadius: 0,
    flatMin: [0, 0, 0], flatMax: [0, 0, 0],
  };
}

/** Extents of a patch that hasn't been meshed: its rectangle, widened by `uvMargin`, at any height in the range. */
export function populateCellPlanetMorphPatchExtents(
  bounds: ITerrainPatchBounds,
  radius: number,
  projectionKind: MapProjectionKind,
  minHeightM: number,
  maxHeightM: number,
  uvMargin: number,
  target: ICellPlanetMorphPatchExtents,
): void {
  const extraU = (bounds.maxU - bounds.minU) * uvMargin;
  const extraV = (bounds.maxV - bounds.minV) * uvMargin;
  target.minU = bounds.minU - extraU;
  target.maxU = bounds.maxU + extraU;
  target.minV = Math.max(-Math.PI / 2, bounds.minV - extraV);
  target.maxV = Math.min(Math.PI / 2, bounds.maxV + extraV);
  target.minRadius = radius + minHeightM;
  target.maxRadius = radius + maxHeightM;

  // As in populateCellPlanetMorphPatchBounds: these points hold every X extremum.
  const projection = MAP_PROJECTIONS[projectionKind];
  const width = 2 * Math.PI * radius;
  const height = Math.PI * radius;
  let flatMinX = Infinity;
  let flatMaxX = -Infinity;
  for (const lat of [target.minV, target.maxV, Math.max(target.minV, Math.min(target.maxV, 0))]) {
    for (const lon of [target.minU, target.maxU]) {
      const x = projection.project(lon, lat, width, height).x - width / 2;
      flatMinX = Math.min(flatMinX, x);
      flatMaxX = Math.max(flatMaxX, x);
    }
  }
  target.flatMin[0] = flatMinX;
  target.flatMax[0] = flatMaxX;
  target.flatMin[1] = height / 2 - projection.project(0, target.minV, width, height).y;
  target.flatMax[1] = height / 2 - projection.project(0, target.maxV, width, height).y;
  target.flatMin[2] = minHeightM;
  target.flatMax[2] = maxHeightM;
}

/**
 * The largest signed distance any point of the patch can have from a plane
 * (n·p + constant, with |n| = 1). Exact for the globe: n·dir over the
 * rectangle is cosLat·A·cos(lon − φ) + ny·sinLat, so the longitude and
 * latitude maxima have closed forms. A morph between the two shapes is bounded
 * by blending their separate maxima.
 */
export function maximumCellPlanetPatchPlaneDistance(
  extents: ICellPlanetMorphPatchExtents,
  morph: number,
  nx: number,
  ny: number,
  nz: number,
  constant: number,
): number {
  let sphereMax = 0;
  if (morph < 1) {
    const horizontal = Math.hypot(nx, nz);
    const phase = Math.atan2(nx, nz);
    const c = horizontal * cosineRange(extents.minU - phase, extents.maxU - phase)[1];
    const nearestLat = Math.max(extents.minV, Math.min(extents.maxV, Math.atan2(ny, c)));
    const dotAt = (lat: number) => c * Math.cos(lat) + ny * Math.sin(lat);
    const dot = Math.max(dotAt(extents.minV), dotAt(extents.maxV), dotAt(nearestLat));
    sphereMax = dot * (dot >= 0 ? extents.maxRadius : extents.minRadius);
  }
  let flatMax = 0;
  if (morph > 0) {
    const { flatMin, flatMax: high } = extents;
    flatMax =
      nx * (nx >= 0 ? high[0] : flatMin[0]) +
      ny * (ny >= 0 ? high[1] : flatMin[1]) +
      nz * (nz >= 0 ? high[2] : flatMin[2]);
  }
  return (1 - morph) * sphereMax + morph * flatMax + constant;
}
