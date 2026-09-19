import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { IVec3 } from 'triangular-engine/worldgen';
import { MAP_PROJECTIONS, MapProjectionKind } from './map-projections';

export interface IPlanetMorphBorderGeometryParams {
  readonly radius?: number;
  readonly borderWidth?: number;
  readonly clearance?: number;
  readonly projectionKind?: MapProjectionKind;
  readonly longitudeSegments?: number;
  readonly latitudeRings?: number;
}

export interface IPlanetMorphBorderGeometryData {
  readonly geometry: BufferGeometry;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly borderWidth: number;
}

interface IBorderVertexSpec {
  lon: number;
  lat: number;
  isTick: boolean;
  edge: 'top' | 'right' | 'bottom' | 'left';
  edgeFrac: number;
}

/**
 * Builds a continuous procedural quad-ribbon BufferGeometry that frames the map perimeter.
 *
 * Conforms to both Equirectangular (2:1 rectangle) and Equal Earth (pseudocylindrical curved arcs).
 * Provides dual-position attributes (`aSpherePos`, `aFlatPos`, `aSphereNorm`, `aFlatNorm`) so it
 * unrolls and morphs in exact lockstep with the planet terrain and ocean meshes.
 */
export function buildPlanetMorphBorderGeometry(
  params: IPlanetMorphBorderGeometryParams = {},
): IPlanetMorphBorderGeometryData {
  const radius = params.radius ?? 2.0;
  const borderWidth = params.borderWidth ?? 0.07;
  const clearance = params.clearance ?? 0.02;
  const projectionKind = params.projectionKind ?? 'equalEarth';
  const projection = MAP_PROJECTIONS[projectionKind];
  const lonSegments = Math.max(16, Math.floor(params.longitudeSegments ?? 128));
  const latRings = Math.max(8, Math.floor(params.latitudeRings ?? 64));

  const mapWidth = 2 * Math.PI * radius;
  const mapHeight = Math.PI * radius;

  // Collect perimeter loop sample points in clockwise order:
  // 1. Top edge: lat = +PI/2, lon from -PI to +PI
  // 2. Right edge: lon = +PI, lat from +PI/2 to -PI/2
  // 3. Bottom edge: lat = -PI/2, lon from +PI to -PI
  // 4. Left edge: lon = -PI, lat from -PI/2 to +PI/2
  const borderSpecs: IBorderVertexSpec[] = [];

  // Top edge (North Pole line)
  for (let i = 0; i < lonSegments; i++) {
    const frac = i / lonSegments;
    const lon = -Math.PI + frac * 2 * Math.PI;
    const deg = (lon * 180) / Math.PI;
    const isTick = Math.abs(deg % 30) < 1.0 || Math.abs(Math.abs(deg % 30) - 30) < 1.0;
    borderSpecs.push({ lon, lat: Math.PI / 2, isTick, edge: 'top', edgeFrac: frac });
  }

  // Right edge (East antimeridian)
  for (let i = 0; i < latRings; i++) {
    const frac = i / latRings;
    const lat = Math.PI / 2 - frac * Math.PI;
    const deg = (lat * 180) / Math.PI;
    const isTick = Math.abs(deg % 30) < 1.0 || Math.abs(Math.abs(deg % 30) - 30) < 1.0;
    borderSpecs.push({ lon: Math.PI, lat, isTick, edge: 'right', edgeFrac: frac });
  }

  // Bottom edge (South Pole line)
  for (let i = 0; i < lonSegments; i++) {
    const frac = i / lonSegments;
    const lon = Math.PI - frac * 2 * Math.PI;
    const deg = (lon * 180) / Math.PI;
    const isTick = Math.abs(deg % 30) < 1.0 || Math.abs(Math.abs(deg % 30) - 30) < 1.0;
    borderSpecs.push({ lon, lat: -Math.PI / 2, isTick, edge: 'bottom', edgeFrac: frac });
  }

  // Left edge (West antimeridian)
  for (let i = 0; i < latRings; i++) {
    const frac = i / latRings;
    const lat = -Math.PI / 2 + frac * Math.PI;
    const deg = (lat * 180) / Math.PI;
    const isTick = Math.abs(deg % 30) < 1.0 || Math.abs(Math.abs(deg % 30) - 30) < 1.0;
    borderSpecs.push({ lon: -Math.PI, lat, isTick, edge: 'left', edgeFrac: frac });
  }

  const loopCount = borderSpecs.length;

  // For each perimeter sample, compute inner (on map boundary) and outer (offset by borderWidth) positions
  interface IBorderPair {
    innerSphere: Vector3;
    outerSphere: Vector3;
    innerFlat: Vector3;
    outerFlat: Vector3;
    innerNormSphere: Vector3;
    outerNormSphere: Vector3;
    isTick: number;
    loopFrac: number;
  }

  const pairs: IBorderPair[] = [];

  for (let i = 0; i < loopCount; i++) {
    const spec = borderSpecs[i];
    const loopFrac = i / loopCount;

    // Inner 2.5D position: evaluated through active projection
    const proj = projection.project(spec.lon, spec.lat, mapWidth, mapHeight);
    const inFlatX = (proj.x / mapWidth - 0.5) * mapWidth;
    const inFlatY = -(proj.y / mapHeight - 0.5) * mapHeight;
    const inFlatZ = clearance;
    const innerFlat = new Vector3(inFlatX, inFlatY, inFlatZ);

    // Compute outward 2D normal for outer offset in flat space
    let outNx = 0;
    let outNy = 0;

    if (spec.edge === 'top') {
      outNx = 0;
      outNy = 1;
    } else if (spec.edge === 'bottom') {
      outNx = 0;
      outNy = -1;
    } else if (spec.edge === 'right') {
      if (projectionKind === 'equirectangular') {
        outNx = 1;
        outNy = 0;
      } else {
        // Equal Earth right boundary: numerical tangent
        const dLat = 0.02;
        const p1 = projection.project(spec.lon, Math.max(-Math.PI / 2, spec.lat - dLat), mapWidth, mapHeight);
        const p2 = projection.project(spec.lon, Math.min(Math.PI / 2, spec.lat + dLat), mapWidth, mapHeight);
        const tx = (p2.x - p1.x);
        const ty = -(p2.y - p1.y);
        const tLen = Math.hypot(tx, ty) || 1;
        // Tangent points roughly +Y, outward right normal is (ty, -tx) normalized
        outNx = ty / tLen;
        outNy = -tx / tLen;
      }
    } else {
      // Left edge
      if (projectionKind === 'equirectangular') {
        outNx = -1;
        outNy = 0;
      } else {
        // Equal Earth left boundary
        const dLat = 0.02;
        const p1 = projection.project(spec.lon, Math.max(-Math.PI / 2, spec.lat - dLat), mapWidth, mapHeight);
        const p2 = projection.project(spec.lon, Math.min(Math.PI / 2, spec.lat + dLat), mapWidth, mapHeight);
        const tx = (p2.x - p1.x);
        const ty = -(p2.y - p1.y);
        const tLen = Math.hypot(tx, ty) || 1;
        // Tangent points roughly +Y, outward left normal is (-ty, tx) normalized
        outNx = -ty / tLen;
        outNy = tx / tLen;
      }
    }

    const outerFlat = new Vector3(
      inFlatX + outNx * borderWidth,
      inFlatY + outNy * borderWidth,
      inFlatZ,
    );

    // Inner 3D Sphere position
    const cosLat = Math.cos(spec.lat);
    const sinLat = Math.sin(spec.lat);
    const dirX = cosLat * Math.sin(spec.lon);
    const dirY = sinLat;
    const dirZ = cosLat * Math.cos(spec.lon);

    const innerDisplacedR = radius + clearance;
    const innerSphere = new Vector3(
      dirX * innerDisplacedR,
      dirY * innerDisplacedR,
      dirZ * innerDisplacedR - radius,
    );
    const innerNormSphere = new Vector3(dirX, dirY, dirZ).normalize();

    // Outer 3D Sphere position: displaced along sphere normal + outward rim offset
    const outerDisplacedR = radius + clearance + borderWidth * 0.2;
    const outerDirX = dirX + outNx * (borderWidth / radius) * 0.4;
    const outerDirY = dirY + outNy * (borderWidth / radius) * 0.4;
    const outerDirZ = dirZ;
    const outerNormSphere = new Vector3(outerDirX, outerDirY, outerDirZ).normalize();

    const outerSphere = new Vector3(
      outerNormSphere.x * outerDisplacedR,
      outerNormSphere.y * outerDisplacedR,
      outerNormSphere.z * outerDisplacedR - radius,
    );

    pairs.push({
      innerSphere,
      outerSphere,
      innerFlat,
      outerFlat,
      innerNormSphere,
      outerNormSphere,
      isTick: spec.isTick ? 1.0 : 0.0,
      loopFrac,
    });
  }

  // Build quad strip as non-indexed triangles
  const quadCount = loopCount;
  const triangleCount = quadCount * 2;
  const totalVertices = triangleCount * 3;

  const positions = new Float32Array(totalVertices * 3);
  const spherePositions = new Float32Array(totalVertices * 3);
  const flatPositions = new Float32Array(totalVertices * 3);
  const sphereNormals = new Float32Array(totalVertices * 3);
  const flatNormals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const ticks = new Float32Array(totalVertices);

  let vPtr3 = 0;
  let vPtr2 = 0;
  let vPtr1 = 0;

  const writeVertex = (
    spherePos: Vector3,
    flatPos: Vector3,
    sphereNorm: Vector3,
    u: number,
    v: number,
    tick: number,
  ): void => {
    // Default initial position starts at sphere
    positions[vPtr3] = spherePos.x;
    positions[vPtr3 + 1] = spherePos.y;
    positions[vPtr3 + 2] = spherePos.z;

    spherePositions[vPtr3] = spherePos.x;
    spherePositions[vPtr3 + 1] = spherePos.y;
    spherePositions[vPtr3 + 2] = spherePos.z;

    flatPositions[vPtr3] = flatPos.x;
    flatPositions[vPtr3 + 1] = flatPos.y;
    flatPositions[vPtr3 + 2] = flatPos.z;

    sphereNormals[vPtr3] = sphereNorm.x;
    sphereNormals[vPtr3 + 1] = sphereNorm.y;
    sphereNormals[vPtr3 + 2] = sphereNorm.z;

    flatNormals[vPtr3] = 0;
    flatNormals[vPtr3 + 1] = 0;
    flatNormals[vPtr3 + 2] = 1;

    uvs[vPtr2] = u;
    uvs[vPtr2 + 1] = v;

    ticks[vPtr1] = tick;

    vPtr3 += 3;
    vPtr2 += 2;
    vPtr1 += 1;
  };

  for (let i = 0; i < quadCount; i++) {
    const next = (i + 1) % loopCount;
    const p0 = pairs[i];
    const p1 = pairs[next];

    const u0 = p0.loopFrac;
    const u1 = p1.loopFrac < u0 ? 1.0 : p1.loopFrac;

    // Triangle 1: inner0, outer0, inner1
    writeVertex(p0.innerSphere, p0.innerFlat, p0.innerNormSphere, u0, 0.0, p0.isTick);
    writeVertex(p0.outerSphere, p0.outerFlat, p0.outerNormSphere, u0, 1.0, p0.isTick);
    writeVertex(p1.innerSphere, p1.innerFlat, p1.innerNormSphere, u1, 0.0, p1.isTick);

    // Triangle 2: inner1, outer0, outer1
    writeVertex(p1.innerSphere, p1.innerFlat, p1.innerNormSphere, u1, 0.0, p1.isTick);
    writeVertex(p0.outerSphere, p0.outerFlat, p0.outerNormSphere, u0, 1.0, p0.isTick);
    writeVertex(p1.outerSphere, p1.outerFlat, p1.outerNormSphere, u1, 1.0, p1.isTick);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aTick', new BufferAttribute(ticks, 1));
  geometry.computeBoundingSphere();

  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius = Math.max(mapWidth, mapHeight, radius * 3);
  }

  return {
    geometry,
    vertexCount: totalVertices,
    triangleCount,
    mapWidth,
    mapHeight,
    borderWidth,
  };
}
