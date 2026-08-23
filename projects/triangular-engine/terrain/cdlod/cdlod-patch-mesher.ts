import {
  ICelestialBody,
  ISurfaceSampler,
  Vec3d,
} from 'triangular-engine/celestial';
import {
  faceUvToDirection,
  IPlanetPatchAddress,
  planetPatchUvBounds,
} from './cdlod-quadtree';
import { BufferAttribute, BufferGeometry } from 'three';

export const TERRAIN_GEOMETRY_FLAG = 'triangular:terrain';
export const BASE_PLACEMENT_TERRAIN_FLAG = 'base-placement-terrain';

export interface ICdlodMeshResult {
  geometry: BufferGeometry;
  triangleCount: number;
  minElevationM: number;
  maxElevationM: number;
}

export interface ICdlodRawPatchBuffers {
  positions: Float32Array;
  coarsePositions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
  uvs: Float32Array;
  elevations?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  resolution: number;
  minElevationM: number;
  maxElevationM: number;
  triangleCount: number;
}

const INDEX_BUFFER_CACHE = new Map<number, Uint16Array | Uint32Array>();

export function getOrCreateGridIndices(resolution: number): Uint16Array | Uint32Array {
  let indices = INDEX_BUFFER_CACHE.get(resolution);
  if (indices) return indices;

  const rowLength = resolution + 1;
  const quadCount = resolution * resolution;
  const indexCount = quadCount * 6;
  const is32Bit = rowLength * rowLength > 65535;
  const array = is32Bit ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let offset = 0;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const v00 = y * rowLength + x;
      const v10 = v00 + 1;
      const v01 = v00 + rowLength;
      const v11 = v01 + 1;

      array[offset++] = v00;
      array[offset++] = v10;
      array[offset++] = v01;

      array[offset++] = v10;
      array[offset++] = v11;
      array[offset++] = v01;
    }
  }

  INDEX_BUFFER_CACHE.set(resolution, array);
  return array;
}

/**
 * Computes procedural color based on elevation and slope normal
 */
function computeVertexColor(
  elevationM: number,
  slope: number,
  seaLevelM: number,
): [number, number, number] {
  if (elevationM < seaLevelM) {
    // Ocean depth gradient
    const depth = Math.min(1, (seaLevelM - elevationM) / 1000);
    return [0.05 + 0.05 * (1 - depth), 0.15 + 0.25 * (1 - depth), 0.35 + 0.3 * (1 - depth)];
  }

  if (elevationM < seaLevelM + 30) {
    // Shoreline wet sand
    const t = (elevationM - seaLevelM) / 30;
    return [0.76 - 0.5 * t, 0.7 - 0.2 * t, 0.52 - 0.3 * t];
  }

  // Steep rock slope
  if (slope < 0.68) {
    return [0.42, 0.39, 0.35];
  }

  // Alpine snow peak
  if (elevationM > 4500) {
    return [0.92, 0.94, 0.97];
  }

  // Highlands rock
  if (elevationM > 2500) {
    const t = (elevationM - 2500) / 2000;
    return [0.35 + 0.55 * t, 0.45 + 0.45 * t, 0.25 + 0.65 * t];
  }

  // Rolling green meadows / plains
  return [0.22, 0.48, 0.18];
}

/**
 * Generates raw typed array buffers for terrain patch (worker-safe, 0-copy transferable).
 */
export function generateCdlodPatchRawBuffers(
  body: ICelestialBody,
  sampler: ISurfaceSampler,
  address: IPlanetPatchAddress,
  resolution: number,
  centerBodyFixedM: Vec3d,
): ICdlodRawPatchBuffers {
  const bounds = planetPatchUvBounds(address);
  const uSpan = bounds.maxU - bounds.minU;
  const vSpan = bounds.maxV - bounds.minV;

  const rowLength = resolution + 1;
  const vertexCount = rowLength * rowLength;

  const positions = new Float32Array(vertexCount * 3);
  const coarsePositions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const elevations = new Float32Array(vertexCount);

  const stepU = uSpan / resolution;
  const stepV = vSpan / resolution;

  const extRes = resolution + 2;
  const extCount = extRes * extRes;
  const extDirs = new Float64Array(extCount * 3);

  for (let ey = 0; ey < extRes; ey++) {
    const v = bounds.minV + (ey - 1) * stepV;
    for (let ex = 0; ex < extRes; ex++) {
      const u = bounds.minU + (ex - 1) * stepU;
      const dir = faceUvToDirection(address.face, u, v);
      const off = (ey * extRes + ex) * 3;
      extDirs[off] = dir[0];
      extDirs[off + 1] = dir[1];
      extDirs[off + 2] = dir[2];
    }
  }

  const extElevations = sampler.sampleBatch(extDirs);
  const extPoints = new Float64Array(extCount * 3);
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;

  for (let i = 0; i < extCount; i++) {
    const elev = extElevations[i];
    if (elev < minElevationM) minElevationM = elev;
    if (elev > maxElevationM) maxElevationM = elev;
    const r = body.radiusM + elev;
    const off = i * 3;
    extPoints[off] = extDirs[off] * r;
    extPoints[off + 1] = extDirs[off + 1] * r;
    extPoints[off + 2] = extDirs[off + 2] * r;
  }

  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const vIndex = y * rowLength + x;
      const extIndex = (y + 1) * extRes + (x + 1);

      const wx = extPoints[extIndex * 3];
      const wy = extPoints[extIndex * 3 + 1];
      const wz = extPoints[extIndex * 3 + 2];

      const elev = extElevations[extIndex];
      elevations[vIndex] = elev;

      const lx = wx - centerBodyFixedM[0];
      const ly = wy - centerBodyFixedM[1];
      const lz = wz - centerBodyFixedM[2];

      positions[vIndex * 3] = lx;
      positions[vIndex * 3 + 1] = ly;
      positions[vIndex * 3 + 2] = lz;

      // Odd/even morph snapping for CDLOD:
      const isOddX = (x % 2) !== 0;
      const isOddY = (y % 2) !== 0;

      let cx = wx;
      let cy = wy;
      let cz = wz;

      if (isOddX && isOddY) {
        const i00 = y * extRes + x;
        const i10 = y * extRes + (x + 2);
        const i01 = (y + 2) * extRes + x;
        const i11 = (y + 2) * extRes + (x + 2);
        cx = (extPoints[i00 * 3] + extPoints[i10 * 3] + extPoints[i01 * 3] + extPoints[i11 * 3]) * 0.25;
        cy = (extPoints[i00 * 3 + 1] + extPoints[i10 * 3 + 1] + extPoints[i01 * 3 + 1] + extPoints[i11 * 3 + 1]) * 0.25;
        cz = (extPoints[i00 * 3 + 2] + extPoints[i10 * 3 + 2] + extPoints[i01 * 3 + 2] + extPoints[i11 * 3 + 2]) * 0.25;
      } else if (isOddX) {
        const iLeft = (y + 1) * extRes + x;
        const iRight = (y + 1) * extRes + (x + 2);
        cx = (extPoints[iLeft * 3] + extPoints[iRight * 3]) * 0.5;
        cy = (extPoints[iLeft * 3 + 1] + extPoints[iRight * 3 + 1]) * 0.5;
        cz = (extPoints[iLeft * 3 + 2] + extPoints[iRight * 3 + 2]) * 0.5;
      } else if (isOddY) {
        const iBot = y * extRes + (x + 1);
        const iTop = (y + 2) * extRes + (x + 1);
        cx = (extPoints[iBot * 3] + extPoints[iTop * 3]) * 0.5;
        cy = (extPoints[iBot * 3 + 1] + extPoints[iTop * 3 + 1]) * 0.5;
        cz = (extPoints[iBot * 3 + 2] + extPoints[iTop * 3 + 2]) * 0.5;
      }

      coarsePositions[vIndex * 3] = cx - centerBodyFixedM[0];
      coarsePositions[vIndex * 3 + 1] = cy - centerBodyFixedM[1];
      coarsePositions[vIndex * 3 + 2] = cz - centerBodyFixedM[2];

      // Central difference normal calculation
      const leftIdx = (y + 1) * extRes + x;
      const rightIdx = (y + 1) * extRes + (x + 2);
      const botIdx = y * extRes + (x + 1);
      const topIdx = (y + 2) * extRes + (x + 1);

      const dxX = extPoints[rightIdx * 3] - extPoints[leftIdx * 3];
      const dxY = extPoints[rightIdx * 3 + 1] - extPoints[leftIdx * 3 + 1];
      const dxZ = extPoints[rightIdx * 3 + 2] - extPoints[leftIdx * 3 + 2];

      const dyX = extPoints[topIdx * 3] - extPoints[botIdx * 3];
      const dyY = extPoints[topIdx * 3 + 1] - extPoints[botIdx * 3 + 1];
      const dyZ = extPoints[topIdx * 3 + 2] - extPoints[botIdx * 3 + 2];

      let nx = dxY * dyZ - dxZ * dyY;
      let ny = dxZ * dyX - dxX * dyZ;
      let nz = dxX * dyY - dxY * dyX;

      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      normals[vIndex * 3] = nx;
      normals[vIndex * 3 + 1] = ny;
      normals[vIndex * 3 + 2] = nz;

      // Compute slope relative to body-fixed radial direction
      const wLen = Math.hypot(wx, wy, wz) || 1;
      const rx = wx / wLen;
      const ry = wy / wLen;
      const rz = wz / wLen;
      const slope = Math.max(0, nx * rx + ny * ry + nz * rz);

      const [cr, cg, cb] = computeVertexColor(elev, slope, 0.0);
      colors[vIndex * 3] = cr;
      colors[vIndex * 3 + 1] = cg;
      colors[vIndex * 3 + 2] = cb;

      uvs[vIndex * 2] = x / resolution;
      uvs[vIndex * 2 + 1] = y / resolution;
    }
  }

  return {
    positions,
    coarsePositions,
    normals,
    colors,
    uvs,
    elevations,
    resolution,
    minElevationM,
    maxElevationM,
    triangleCount: (resolution * resolution * 2),
  };
}

/**
 * Generates raw typed array buffers for Cubesphere ocean patch (worker-safe, 0-copy transferable).
 */
export function generateCdlodOceanPatchRawBuffers(
  body: ICelestialBody,
  address: IPlanetPatchAddress,
  resolution: number,
  centerBodyFixedM: Vec3d,
): ICdlodRawPatchBuffers {
  const bounds = planetPatchUvBounds(address);
  const uSpan = bounds.maxU - bounds.minU;
  const vSpan = bounds.maxV - bounds.minV;

  const rowLength = resolution + 1;
  const vertexCount = rowLength * rowLength;

  const positions = new Float32Array(vertexCount * 3);
  const coarsePositions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const stepU = uSpan / resolution;
  const stepV = vSpan / resolution;
  const r = body.radiusM;

  for (let y = 0; y <= resolution; y++) {
    const v = bounds.minV + y * stepV;
    for (let x = 0; x <= resolution; x++) {
      const u = bounds.minU + x * stepU;
      const dir = faceUvToDirection(address.face, u, v);
      const vIdx = y * rowLength + x;
      const off = vIdx * 3;

      positions[off] = dir[0] * r - centerBodyFixedM[0];
      positions[off + 1] = dir[1] * r - centerBodyFixedM[1];
      positions[off + 2] = dir[2] * r - centerBodyFixedM[2];

      normals[off] = dir[0];
      normals[off + 1] = dir[1];
      normals[off + 2] = dir[2];

      const uvOff = vIdx * 2;
      uvs[uvOff] = x / resolution;
      uvs[uvOff + 1] = y / resolution;

      const cx = (x % 2 !== 0) ? ((x + 1 <= resolution) ? x + 1 : x - 1) : x;
      const cy = (y % 2 !== 0) ? ((y + 1 <= resolution) ? y + 1 : y - 1) : y;
      const cDir = faceUvToDirection(address.face, bounds.minU + cx * stepU, bounds.minV + cy * stepV);
      coarsePositions[off] = cDir[0] * r - centerBodyFixedM[0];
      coarsePositions[off + 1] = cDir[1] * r - centerBodyFixedM[1];
      coarsePositions[off + 2] = cDir[2] * r - centerBodyFixedM[2];
    }
  }

  return {
    positions,
    coarsePositions,
    normals,
    uvs,
    resolution,
    minElevationM: 0,
    maxElevationM: 0,
    triangleCount: (resolution * resolution * 2),
  };
}

/**
 * Reconstructs a Three.js BufferGeometry from raw transferred typed arrays in 0.001ms.
 */
export function reconstructCdlodBufferGeometry(
  raw: ICdlodRawPatchBuffers,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(raw.positions, 3));
  geometry.setAttribute('coarsePosition', new BufferAttribute(raw.coarsePositions, 3));
  geometry.setAttribute('normal', new BufferAttribute(raw.normals, 3));
  if (raw.colors) {
    geometry.setAttribute('color', new BufferAttribute(raw.colors, 3));
  }
  geometry.setAttribute('uv', new BufferAttribute(raw.uvs, 2));
  if (raw.elevations) {
    geometry.setAttribute('elevation', new BufferAttribute(raw.elevations, 1));
  }

  const indices = raw.indices ?? getOrCreateGridIndices(raw.resolution);
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.userData[TERRAIN_GEOMETRY_FLAG] = true;
  geometry.userData[BASE_PLACEMENT_TERRAIN_FLAG] = true;

  return geometry;
}

/**
 * Generates patch BufferGeometry synchronously relative to patch-local center
 */
export function generateCdlodPatchGeometry(
  body: ICelestialBody,
  sampler: ISurfaceSampler,
  address: IPlanetPatchAddress,
  resolution: number,
  centerBodyFixedM: Vec3d,
): ICdlodMeshResult {
  const raw = generateCdlodPatchRawBuffers(body, sampler, address, resolution, centerBodyFixedM);
  const geometry = reconstructCdlodBufferGeometry(raw);

  return {
    geometry,
    triangleCount: raw.triangleCount,
    minElevationM: raw.minElevationM,
    maxElevationM: raw.maxElevationM,
  };
}

/**
 * Generates an identical shared-topology Cubesphere Ocean patch geometry at sea level synchronously
 */
export function generateCdlodOceanPatchGeometry(
  body: ICelestialBody,
  address: IPlanetPatchAddress,
  resolution: number,
  centerBodyFixedM: Vec3d,
): ICdlodMeshResult {
  const raw = generateCdlodOceanPatchRawBuffers(body, address, resolution, centerBodyFixedM);
  const geometry = reconstructCdlodBufferGeometry(raw);

  return {
    geometry,
    triangleCount: raw.triangleCount,
    minElevationM: 0,
    maxElevationM: 0,
  };
}
