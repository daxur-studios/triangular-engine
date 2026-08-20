import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { ISurfaceSampler } from '../surface-sampler';
import {
  fractalNoise3d,
  ridgedFractalNoise3d,
  smoothstep,
} from '../terrain-noise';
import {
  ICylinderPatchAddress,
  cylinderPatchBounds,
} from './cdlod-cylinder-quadtree';
import {
  ICdlodMeshResult,
  ICdlodRawPatchBuffers,
  reconstructCdlodBufferGeometry,
} from './cdlod-patch-mesher';

/**
 * Creates a seamless periodic cylindrical surface sampler.
 *
 * Uses 3D circle embedding (u = R*cos(theta), v = R*sin(theta), z) so that
 * procedural fractals wrap continuously around the 360-degree circumference
 * with ZERO edge seams or height discrepancies.
 */
export function createCylinderSurfaceSampler(
  bodyOrFn?: ICelestialBody | ((theta: number, z: number) => number),
  radiusM = 4000,
): ISurfaceSampler {
  if (typeof bodyOrFn === 'function') {
    const fn = bodyOrFn;
    return {
      minElevationM: -100,
      maxElevationM: 400,
      sample: ([x, _y, z]) => {
        const theta = x / radiusM;
        return { elevationM: fn(theta, z) };
      },
      sampleBatch: (positions, out) => {
        const res = out ?? new Float64Array(positions.length / 3);
        for (let i = 0; i < res.length; i++) {
          const x = positions[i * 3];
          const z = positions[i * 3 + 2];
          res[i] = fn(x / radiusM, z);
        }
        return res;
      },
      sampleBiome: () => ({ dominantBiomeIndex: -1, weights: [] }),
      sampleDominantBiomeBatch: (positions, dominantBiomeIndices) => {
        const count = positions.length / 3;
        const res = dominantBiomeIndices ?? new Uint16Array(count);
        res.fill(0xffff);
        return res;
      },
    };
  }

  const seed = ((bodyOrFn?.terrain?.seed ?? 42) & 0xffff) + 1337;
  const bodyId = bodyOrFn?.id ?? 'home-planet';

  // Periodic 3D embedding: (u, v, z) with u = R*cos(theta), v = R*sin(theta)
  const sampleElevationCylinder = (x: number, z: number): number => {
    const theta = x / radiusM;
    const u = radiusM * Math.cos(theta);
    const v = radiusM * Math.sin(theta);

    if (bodyId === 'alpine-planet') {
      const baseMountains =
        ridgedFractalNoise3d(
          u,
          v,
          z,
          {
            frequency: 1 / 1800,
            octaves: 6,
            lacunarity: 2.05,
            persistence: 0.55,
            ridgeExponent: 1.8,
          },
          seed + 10,
        ) * 550;
      const hills =
        fractalNoise3d(
          u,
          v,
          z,
          {
            frequency: 1 / 400,
            octaves: 4,
            lacunarity: 2.1,
            persistence: 0.45,
          },
          seed + 20,
        ) * 45;
      return baseMountains + hills;
    }

    if (bodyId === 'canyon-planet') {
      const rawPlateau = fractalNoise3d(
        u,
        v,
        z,
        {
          frequency: 1 / 2400,
          octaves: 4,
          lacunarity: 2.0,
          persistence: 0.5,
        },
        seed + 30,
      );
      const terraced =
        Math.floor(rawPlateau * 5) / 5 +
        Math.pow(Math.abs((rawPlateau * 5) % 1), 3) * 0.2;
      const fineDetail =
        fractalNoise3d(
          u,
          v,
          z,
          {
            frequency: 1 / 250,
            octaves: 4,
            lacunarity: 2.0,
            persistence: 0.5,
          },
          seed + 40,
        ) * 35;
      return terraced * 450 + fineDetail;
    }

    if (bodyId === 'cratered-moon') {
      const maria =
        fractalNoise3d(
          u,
          v,
          z,
          {
            frequency: 1 / 3000,
            octaves: 3,
            lacunarity: 2.0,
            persistence: 0.5,
          },
          seed + 50,
        ) * 120;
      const craters =
        Math.abs(
          fractalNoise3d(
            u,
            v,
            z,
            {
              frequency: 1 / 500,
              octaves: 5,
              lacunarity: 2.2,
              persistence: 0.6,
            },
            seed + 60,
          ),
        ) * 80;
      return maria - craters;
    }

    // Default: Home planet interior parklands, river canals, gentle rolling meadows
    const continents = fractalNoise3d(
      u,
      v,
      z,
      {
        frequency: 1 / 3000,
        octaves: 4,
        lacunarity: 2.0,
        persistence: 0.5,
      },
      seed,
    );

    const mountains =
      ridgedFractalNoise3d(
        u,
        v,
        z,
        {
          frequency: 1 / 1200,
          octaves: 5,
          lacunarity: 2.1,
          persistence: 0.5,
          ridgeExponent: 1.5,
        },
        seed + 1,
      ) *
      300 *
      smoothstep(0.1, 0.6, continents);

    const hills =
      fractalNoise3d(
        u,
        v,
        z,
        {
          frequency: 1 / 350,
          octaves: 4,
          lacunarity: 2.0,
          persistence: 0.45,
        },
        seed + 2,
      ) * 40;

    return continents * 80 + mountains + hills;
  };

  return {
    minElevationM: -80,
    maxElevationM: 450,
    sample: ([x, _y, z]) => ({
      elevationM: sampleElevationCylinder(x, z),
    }),
    sampleBatch: (positions, out) => {
      const res = out ?? new Float64Array(positions.length / 3);
      for (let i = 0; i < res.length; i++) {
        const x = positions[i * 3];
        const z = positions[i * 3 + 2];
        res[i] = sampleElevationCylinder(x, z);
      }
      return res;
    },
    sampleBiome: () => ({ dominantBiomeIndex: -1, weights: [] }),
    sampleDominantBiomeBatch: (positions, dominantBiomeIndices) => {
      const count = positions.length / 3;
      const res = dominantBiomeIndices ?? new Uint16Array(count);
      res.fill(0xffff);
      return res;
    },
  };
}

/**
 * Computes procedural color for O'Neill cylinder habitat interior terrain.
 */
function computeCylinderVertexColor(
  elevationM: number,
  slope: number,
  seaLevelM = 0.0,
): [number, number, number] {
  if (elevationM < seaLevelM) {
    // Water canal
    const depth = Math.min(1, (seaLevelM - elevationM) / 60);
    return [
      0.06 + 0.04 * (1 - depth),
      0.28 + 0.22 * (1 - depth),
      0.48 + 0.3 * (1 - depth),
    ];
  }

  // Shoreline / riverbank
  if (elevationM < seaLevelM + 8) {
    const t = (elevationM - seaLevelM) / 8;
    return [0.76 - 0.25 * t, 0.7 - 0.2 * t, 0.5 - 0.3 * t];
  }

  // Steep cliff rock
  if (slope < 0.68) {
    return [0.42, 0.39, 0.36];
  }

  // High elevated terrain
  if (elevationM > 250) {
    const t = Math.min(1, (elevationM - 250) / 80);
    return [0.48 + 0.45 * t, 0.48 + 0.45 * t, 0.48 + 0.5 * t];
  }

  // Highlands / parklands
  if (elevationM > 140) {
    const t = (elevationM - 140) / 110;
    return [0.22 + 0.18 * t, 0.4 - 0.02 * t, 0.18 + 0.18 * t];
  }

  // Lush meadows & green spaces
  return [0.22, 0.52, 0.18];
}

/**
 * Generates raw typed array buffers for an interior cylinder patch (worker-safe, 0-copy transferable).
 */
export function generateCdlodCylinderPatchRawBuffers(
  sampler: ISurfaceSampler,
  address: ICylinderPatchAddress,
  resolution: number,
  radiusM: number,
  centerM: Vec3d,
  rootSectors = 8,
  rootPatchLengthM?: number,
): ICdlodRawPatchBuffers {
  const bounds = cylinderPatchBounds(
    address,
    radiusM,
    rootSectors,
    rootPatchLengthM,
  );

  const { thetaMin, thetaSpan, zMin, zSpan } = bounds;

  const rowLength = resolution + 1;
  const vertexCount = rowLength * rowLength;

  const positions = new Float32Array(vertexCount * 3);
  const coarsePositions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const elevations = new Float32Array(vertexCount);

  const thetaStep = thetaSpan / resolution;
  const zStep = zSpan / resolution;

  const extRes = resolution + 2;
  const extCount = extRes * extRes;
  const extCoords = new Float64Array(extCount * 3);

  for (let ey = 0; ey < extRes; ey++) {
    const z = zMin + (ey - 1) * zStep;
    for (let ex = 0; ex < extRes; ex++) {
      const th = thetaMin + (ex - 1) * thetaStep;
      const arcX = th * radiusM;
      const off = (ey * extRes + ex) * 3;
      extCoords[off] = arcX;
      extCoords[off + 1] = 0;
      extCoords[off + 2] = z;
    }
  }

  const extElevations = sampler.sampleBatch(extCoords);
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;

  for (let i = 0; i < extCount; i++) {
    const elev = extElevations[i];
    if (elev < minElevationM) minElevationM = elev;
    if (elev > maxElevationM) maxElevationM = elev;
  }

  for (let y = 0; y <= resolution; y++) {
    const wz = zMin + y * zStep;
    for (let x = 0; x <= resolution; x++) {
      const th = thetaMin + x * thetaStep;
      const vIndex = y * rowLength + x;
      const extIndex = (y + 1) * extRes + (x + 1);

      const elev = extElevations[extIndex];
      elevations[vIndex] = elev;

      const r = radiusM - elev;
      const px = r * Math.sin(th);
      const py = -r * Math.cos(th);
      const pz = wz;

      positions[vIndex * 3] = px - centerM[0];
      positions[vIndex * 3 + 1] = py - centerM[1];
      positions[vIndex * 3 + 2] = pz - centerM[2];

      // Odd/even morph snapping for CDLOD
      const isOddX = x % 2 !== 0;
      const isOddY = y % 2 !== 0;

      let cTh = th;
      let cElev = elev;
      let cZ = wz;

      if (isOddX && isOddY) {
        const i00 = y * extRes + x;
        const i10 = y * extRes + (x + 2);
        const i01 = (y + 2) * extRes + x;
        const i11 = (y + 2) * extRes + (x + 2);
        cElev =
          (extElevations[i00] +
            extElevations[i10] +
            extElevations[i01] +
            extElevations[i11]) *
          0.25;
      } else if (isOddX) {
        const iLeft = (y + 1) * extRes + x;
        const iRight = (y + 1) * extRes + (x + 2);
        cElev = (extElevations[iLeft] + extElevations[iRight]) * 0.5;
      } else if (isOddY) {
        const iBot = y * extRes + (x + 1);
        const iTop = (y + 2) * extRes + (x + 1);
        cElev = (extElevations[iBot] + extElevations[iTop]) * 0.5;
      }

      const cR = radiusM - cElev;
      coarsePositions[vIndex * 3] = cR * Math.sin(cTh) - centerM[0];
      coarsePositions[vIndex * 3 + 1] = -cR * Math.cos(cTh) - centerM[1];
      coarsePositions[vIndex * 3 + 2] = cZ - centerM[2];

      // Inward surface normal computation
      const leftIdx = (y + 1) * extRes + x;
      const rightIdx = (y + 1) * extRes + (x + 2);
      const botIdx = y * extRes + (x + 1);
      const topIdx = (y + 2) * extRes + (x + 1);

      const dElevS = (extElevations[rightIdx] - extElevations[leftIdx]) / (2 * thetaStep * radiusM);
      const dElevZ = (extElevations[topIdx] - extElevations[botIdx]) / (2 * zStep);

      const sinTh = Math.sin(th);
      const cosTh = Math.cos(th);

      let nx = -sinTh + dElevS * cosTh;
      let ny = cosTh + dElevS * sinTh;
      let nz = -dElevZ;

      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      normals[vIndex * 3] = nx;
      normals[vIndex * 3 + 1] = ny;
      normals[vIndex * 3 + 2] = nz;

      const nominalDot = nx * (-sinTh) + ny * cosTh;
      const slope = Math.max(0, Math.min(1, nominalDot));
      const [cr, cg, cb] = computeCylinderVertexColor(elev, slope);

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
    triangleCount: resolution * resolution * 2,
  };
}

/**
 * Synchronous BufferGeometry generator for Cylinder patch
 */
export function generateCdlodCylinderPatchGeometry(
  sampler: ISurfaceSampler,
  address: ICylinderPatchAddress,
  resolution: number,
  radiusM: number,
  centerM: Vec3d,
  rootSectors = 8,
  rootPatchLengthM?: number,
): ICdlodMeshResult {
  const raw = generateCdlodCylinderPatchRawBuffers(
    sampler,
    address,
    resolution,
    radiusM,
    centerM,
    rootSectors,
    rootPatchLengthM,
  );
  const geometry = reconstructCdlodBufferGeometry(raw);

  return {
    geometry,
    triangleCount: raw.triangleCount,
    minElevationM: raw.minElevationM,
    maxElevationM: raw.maxElevationM,
  };
}
