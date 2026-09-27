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
