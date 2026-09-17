import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import {
  IPlanetSurfaceSampler,
  IVec3,
  normalize,
} from 'triangular-engine/worldgen';
import {
  IMapProjection,
  MAP_PROJECTIONS,
  MapProjectionKind,
} from './map-projections';

export interface IPlanetMorphGeometryParams {
  readonly sampler: IPlanetSurfaceSampler;
  readonly radius?: number;
  readonly heightScale?: number;
  readonly longitudeSegments?: number;
  readonly latitudeRings?: number;
  readonly projectionKind?: MapProjectionKind;
  readonly seabedRelief?: boolean;
  readonly seaLevelElevation?: number;
  readonly resolveColor?: (direction: IVec3, elevation: number, isLand: boolean) => [number, number, number];
}

export interface IPlanetMorphGeometryData {
  readonly geometry: BufferGeometry;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly radius: number;
  readonly heightScale: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export interface ISurfaceTransform {
  readonly position: Vector3;
  readonly normal: Vector3;
}

export interface IProjectionBasis {
  readonly forward: IVec3;
  readonly up: IVec3;
  readonly right: IVec3;
}

/**
 * Computes world position and surface normal for a point given its spherical unit direction
 * and elevation at morph progress `t` (0 = 3D globe, 1 = 2.5D flat map).
 *
 * Both representations share the exact same orientation:
 * +Y is North, +X is East, +Z faces toward the viewer.
 * The front center point sits tangent at Z = 0, and as t -> 0 (Globe),
 * the sides and back curl monotonically backwards into -Z away from the camera.
 *
 * An optional `basis` can be supplied to dynamically center the projection on a moving unit.
 */
export function evaluateSurfaceTransform(
  direction: IVec3,
  elevation: number,
  radius: number,
  heightScale: number,
  projection: IMapProjection,
  mapWidth: number,
  mapHeight: number,
  t: number,
  basis?: IProjectionBasis,
): ISurfaceTransform {
  const normDir = normalize(direction);

  let pLon: number;
  let pLat: number;

  if (basis) {
    const dotFwd = normDir.x * basis.forward.x + normDir.y * basis.forward.y + normDir.z * basis.forward.z;
    const dotRight = normDir.x * basis.right.x + normDir.y * basis.right.y + normDir.z * basis.right.z;
    const dotUp = normDir.x * basis.up.x + normDir.y * basis.up.y + normDir.z * basis.up.z;

    pLon = Math.atan2(dotRight, dotFwd);
    pLat = Math.asin(Math.max(-1, Math.min(1, dotUp)));
  } else {
    pLat = Math.asin(Math.max(-1, Math.min(1, normDir.y)));
    pLon = Math.atan2(normDir.x, normDir.z);
  }

  // 3D Sphere state: front point at Z = 0, center at (0, 0, -radius)
  const displacedRadius = radius + elevation * heightScale;
  const spherePos = new Vector3(
    normDir.x * displacedRadius,
    normDir.y * displacedRadius,
    normDir.z * displacedRadius - radius,
  );
  const sphereNorm = new Vector3(normDir.x, normDir.y, normDir.z);

  // 2.5D Flat map state: in XY plane facing +Z
  const proj = projection.project(pLon, pLat, mapWidth, mapHeight);
  const flatX = (proj.x / mapWidth - 0.5) * mapWidth;
  const flatY = -(proj.y / mapHeight - 0.5) * mapHeight;
  const flatZ = elevation * heightScale;
  const flatPos = new Vector3(flatX, flatY, flatZ);
  const flatNorm = new Vector3(0, 0, 1);

  // Interpolate: front stays anchored while edges curl backward away from camera
  const position = new Vector3().lerpVectors(spherePos, flatPos, t);
  const normal = new Vector3().lerpVectors(sphereNorm, flatNorm, t).normalize();

  return { position, normal };
}

/**
 * Builds a parametric dual-position BufferGeometry with duplicated seam and pole vertices,
 * allowing seamless interpolation between 3D sphere and 2.5D planar projection.
 */
export function buildPlanetMorphGeometry(params: IPlanetMorphGeometryParams): IPlanetMorphGeometryData {
  const segments = Math.max(8, Math.floor(params.longitudeSegments ?? 128));
  const rings = Math.max(4, Math.floor(params.latitudeRings ?? 64));
  const radius = params.radius ?? 2.0;
  const heightScale = params.heightScale ?? 0.15;
  const projectionKind = params.projectionKind ?? 'equalEarth';
  const projection = MAP_PROJECTIONS[projectionKind];
  const seabedRelief = params.seabedRelief ?? true;
  const seaLevel = params.seaLevelElevation ?? 0;

  const mapWidth = 2 * Math.PI * radius;
  const mapHeight = Math.PI * radius;

  const cols = segments + 1;
  const rows = rings + 1;
  const vertexCount = cols * rows;

  const positions = new Float32Array(vertexCount * 3);
  const spherePositions = new Float32Array(vertexCount * 3);
  const flatPositions = new Float32Array(vertexCount * 3);
  const sphereNormals = new Float32Array(vertexCount * 3);
  const flatNormals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let r = 0; r <= rings; r++) {
    const latFrac = r / rings;
    const lat = Math.PI / 2 - latFrac * Math.PI; // +PI/2 (North Pole) to -PI/2 (South Pole)
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let c = 0; c <= segments; c++) {
      const lonFrac = c / segments;
      const lon = -Math.PI + lonFrac * 2 * Math.PI; // -PI to +PI

      // Direction where lon=0 faces +Z, lon=+PI/2 faces +X (East), lat=+PI/2 faces +Y (North)
      const dirX = cosLat * Math.sin(lon);
      const dirY = sinLat;
      const dirZ = cosLat * Math.cos(lon);
      const direction: IVec3 = { x: dirX, y: dirY, z: dirZ };

      const sample = params.sampler.sample(direction);
      const rawElevation = sample.elevation;
      const effectiveElevation = (!seabedRelief && !sample.isLand) ? seaLevel : rawElevation;

      const idx = r * cols + c;
      const o3 = idx * 3;
      const o2 = idx * 2;

      // UV
      uvs[o2] = lonFrac;
      uvs[o2 + 1] = 1 - latFrac;

      // 3D Sphere coordinates (tangent at Z=0, curving into -Z)
      const displacedRadius = radius + effectiveElevation * heightScale;
      spherePositions[o3] = dirX * displacedRadius;
      spherePositions[o3 + 1] = dirY * displacedRadius;
      spherePositions[o3 + 2] = dirZ * displacedRadius - radius;

      sphereNormals[o3] = dirX;
      sphereNormals[o3 + 1] = dirY;
      sphereNormals[o3 + 2] = dirZ;

      // 2.5D Flat coordinates (in XY plane facing +Z)
      const proj = projection.project(lon, lat, mapWidth, mapHeight);
      const flatX = (proj.x / mapWidth - 0.5) * mapWidth;
      const flatY = -(proj.y / mapHeight - 0.5) * mapHeight;
      const flatZ = effectiveElevation * heightScale;

      flatPositions[o3] = flatX;
      flatPositions[o3 + 1] = flatY;
      flatPositions[o3 + 2] = flatZ;

      flatNormals[o3] = 0;
      flatNormals[o3 + 1] = 0;
      flatNormals[o3 + 2] = 1;

      // Default active position attribute starts at sphere
      positions[o3] = spherePositions[o3];
      positions[o3 + 1] = spherePositions[o3 + 1];
      positions[o3 + 2] = spherePositions[o3 + 2];

      // Colors
      if (params.resolveColor) {
        const rgb = params.resolveColor(direction, effectiveElevation, sample.isLand);
        colors[o3] = rgb[0];
        colors[o3 + 1] = rgb[1];
        colors[o3 + 2] = rgb[2];
      } else {
        colors[o3] = sample.isLand ? 0.35 : 0.15;
        colors[o3 + 1] = sample.isLand ? 0.65 : 0.35;
        colors[o3 + 2] = sample.isLand ? 0.25 : 0.75;
      }
    }
  }

  // Indices
  const triangleCount = segments * rings * 2;
  const indices = new Uint32Array(triangleCount * 3);
  let cursor = 0;

  for (let r = 0; r < rings; r++) {
    for (let c = 0; c < segments; c++) {
      const topLeft = r * cols + c;
      const topRight = topLeft + 1;
      const bottomLeft = (r + 1) * cols + c;
      const bottomRight = bottomLeft + 1;

      // Triangle 1
      indices[cursor++] = topLeft;
      indices[cursor++] = bottomLeft;
      indices[cursor++] = topRight;

      // Triangle 2
      indices[cursor++] = bottomLeft;
      indices[cursor++] = bottomRight;
      indices[cursor++] = topRight;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSpherePos', new BufferAttribute(spherePositions, 3));
  geometry.setAttribute('aFlatPos', new BufferAttribute(flatPositions, 3));
  geometry.setAttribute('aSphereNorm', new BufferAttribute(sphereNormals, 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNormals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  // Expand bounding sphere so frustum culling does not clip during morph
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius = Math.max(mapWidth, mapHeight, radius * 3);
  }

  return {
    geometry,
    vertexCount,
    triangleCount,
    radius,
    heightScale,
    mapWidth,
    mapHeight,
  };
}

/**
 * Builds a matching ocean shell geometry that unrolls at the constant sea-level elevation.
 */
export function buildOceanMorphGeometry(
  radius: number,
  heightScale: number,
  seaLevelElevation: number,
  projectionKind: MapProjectionKind = 'equalEarth',
  longitudeSegments = 96,
  latitudeRings = 48,
): IPlanetMorphGeometryData {
  const dummySampler: IPlanetSurfaceSampler = {
    sample: () => ({
      elevation: seaLevelElevation,
      baseElevation: seaLevelElevation,
      ridgeRelief: 0,
      riverCarve: 0,
      seaLevel: seaLevelElevation,
      isLand: false,
    }),
  };

  return buildPlanetMorphGeometry({
    sampler: dummySampler,
    radius,
    heightScale,
    longitudeSegments,
    latitudeRings,
    projectionKind,
    seabedRelief: true,
    seaLevelElevation,
    resolveColor: () => [0.12, 0.38, 0.65],
  });
}
