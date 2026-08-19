import { ICelestialBody } from '../../bodies/celestial-body';
import { Vec3d } from '../../math/vec3';
import { ISurfaceSampler } from '../surface-sampler';
import {
  fractalNoise3d,
  ridgedFractalNoise3d,
  smoothstep,
} from '../terrain-noise';
import {
  IPlanePatchAddress,
  planePatchBounds,
} from './cdlod-plane-quadtree';
import {
  ICdlodMeshResult,
  ICdlodRawPatchBuffers,
  reconstructCdlodBufferGeometry,
} from './cdlod-patch-mesher';

/**
 * Creates a true Cartesian metric 2D surface sampler for infinite flat worlds.
 *
 * Uses multi-octave fractional Brownian motion (fBm) and ridged multifractals
 * without any spherical pole distortion, radial bowl artifacts, or origin singularities.
 */
export function createPlaneSurfaceSampler(
  bodyOrFn?: ICelestialBody | ((x: number, z: number) => number),
): ISurfaceSampler {
  if (typeof bodyOrFn === 'function') {
    const fn = bodyOrFn;
    return {
      minElevationM: -500,
      maxElevationM: 1500,
      sample: ([x, _y, z]) => ({ elevationM: fn(x, z) }),
      sampleBatch: (positions, out) => {
        const res = out ?? new Float64Array(positions.length / 3);
        for (let i = 0; i < res.length; i++) {
          res[i] = fn(positions[i * 3], positions[i * 3 + 2]);
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

  // True translation-invariant 2D planar elevation function
  const sampleElevation2D = (x: number, z: number): number => {
    if (bodyId === 'alpine-planet') {
      // High rugged mountain ranges everywhere
      const baseMountains =
        ridgedFractalNoise3d(
          x,
          0,
          z,
          {
            frequency: 1 / 1800,
            octaves: 6,
            lacunarity: 2.05,
            persistence: 0.55,
            ridgeExponent: 1.8,
          },
          seed + 10,
        ) * 750;
      const hills =
        fractalNoise3d(
          x,
          0,
          z,
          {
            frequency: 1 / 400,
            octaves: 4,
            lacunarity: 2.1,
            persistence: 0.45,
          },
          seed + 20,
        ) * 55;
      return baseMountains + hills;
    }

    if (bodyId === 'canyon-planet') {
      // Layered stepped plateaus and deep rift valleys
      const rawPlateau = fractalNoise3d(
        x,
        0,
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
          x,
          0,
          z,
          {
            frequency: 1 / 300,
            octaves: 4,
            lacunarity: 2.0,
            persistence: 0.4,
          },
          seed + 40,
        ) * 35;
      return terraced * 500 + fineDetail;
    }

    if (
      bodyId === 'cratered-moon' ||
      bodyId === 'home-moon' ||
      bodyId === 'far-moon'
    ) {
      // Rolling cratered basalt
      const rolling =
        fractalNoise3d(
          x,
          0,
          z,
          {
            frequency: 1 / 3200,
            octaves: 4,
            lacunarity: 2.0,
            persistence: 0.5,
          },
          seed + 50,
        ) * 140;
      const craterNoise =
        ridgedFractalNoise3d(
          x,
          0,
          z,
          {
            frequency: 1 / 800,
            octaves: 4,
            lacunarity: 2.2,
            persistence: 0.5,
            ridgeExponent: 2.0,
          },
          seed + 60,
        ) * 90;
      const micro =
        fractalNoise3d(
          x,
          0,
          z,
          {
            frequency: 1 / 150,
            octaves: 3,
            lacunarity: 2.0,
            persistence: 0.4,
          },
          seed + 70,
        ) * 20;
      return rolling + craterNoise + micro;
    }

    // Default 'home-planet' & 'archipelago-planet':
    // Continental noise distributing lush meadows, rolling hills, lake basins, and mountain ranges
    const contNoise = fractalNoise3d(
      x,
      0,
      z,
      {
        frequency: 1 / 4800,
        octaves: 3,
        lacunarity: 2.0,
        persistence: 0.5,
      },
      seed,
    );

    const mountainWeight = smoothstep(0.08, 0.48, contNoise);
    const oceanWeight = smoothstep(-0.08, -0.48, contNoise);

    // Meadows & plains (height: 5m to 55m)
    const meadow =
      fractalNoise3d(
        x,
        0,
        z,
        {
          frequency: 1 / 550,
          octaves: 4,
          lacunarity: 2.0,
          persistence: 0.45,
        },
        seed + 100,
      ) *
        40 +
      25;

    // Mountain ridges (height: 100m to 520m)
    const ridges =
      ridgedFractalNoise3d(
        x,
        0,
        z,
        {
          frequency: 1 / 1200,
          octaves: 5,
          lacunarity: 2.0,
          persistence: 0.55,
          ridgeExponent: 1.8,
        },
        seed + 200,
      ) *
        480 +
      45;

    // Ocean / lake floor (height: -140m to -10m)
    const oceanFloor =
      fractalNoise3d(
        x,
        0,
        z,
        {
          frequency: 1 / 1000,
          octaves: 3,
          lacunarity: 2.0,
          persistence: 0.5,
        },
        seed + 300,
      ) *
        35 -
      75;

    return (
      meadow * (1 - mountainWeight) * (1 - oceanWeight) +
      ridges * mountainWeight +
      oceanFloor * oceanWeight
    );
  };

  return {
    minElevationM: -180,
    maxElevationM: 650,
    sample: ([x, _y, z]) => ({ elevationM: sampleElevation2D(x, z) }),
    sampleBatch: (positions, out) => {
      const count = positions.length / 3;
      const res = out ?? new Float64Array(count);
      for (let i = 0; i < count; i++) {
        res[i] = sampleElevation2D(positions[i * 3], positions[i * 3 + 2]);
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
 * Computes procedural vertex color for flat-plane terrain based on elevation, slope, and body preset.
 */
function computePlaneVertexColor(
  elevationM: number,
  slope: number,
  bodyId = 'home-planet',
  seaLevelM = 0.0,
): [number, number, number] {
  if (bodyId === 'canyon-planet') {
    // Stepped red/orange sandstone strata
    const layer = Math.sin(elevationM / 18) * 0.5 + 0.5;
    if (slope < 0.7) {
      return [0.65 + layer * 0.15, 0.35 + layer * 0.1, 0.22];
    }
    return [0.78 + layer * 0.1, 0.48 + layer * 0.1, 0.3];
  }

  if (
    bodyId === 'cratered-moon' ||
    bodyId === 'home-moon' ||
    bodyId === 'far-moon'
  ) {
    // Lunar gray basalt & bright crater rims
    const brightness = Math.min(1, Math.max(0.18, 0.35 + elevationM / 300));
    if (bodyId === 'far-moon') {
      return [brightness * 0.7, brightness * 0.9, brightness];
    }
    return [brightness, brightness, brightness * 0.96];
  }

  // Earth-like / temperate planet biomes
  if (elevationM < seaLevelM) {
    // Water basin / lake floor
    const depth = Math.min(1, (seaLevelM - elevationM) / 80);
    return [
      0.06 + 0.04 * (1 - depth),
      0.24 + 0.22 * (1 - depth),
      0.45 + 0.3 * (1 - depth),
    ];
  }

  // Sandy shoreline
  if (elevationM < seaLevelM + 10) {
    const t = (elevationM - seaLevelM) / 10;
    return [0.76 - 0.25 * t, 0.7 - 0.2 * t, 0.5 - 0.3 * t];
  }

  // Steep rock cliff
  if (slope < 0.7) {
    return [0.42, 0.39, 0.36];
  }

  // Alpine snow peak
  if (elevationM > 300) {
    const t = Math.min(1, (elevationM - 300) / 80);
    return [0.45 + 0.5 * t, 0.45 + 0.5 * t, 0.45 + 0.52 * t];
  }

  // Sub-alpine highland
  if (elevationM > 180) {
    const t = (elevationM - 180) / 120;
    return [0.24 + 0.18 * t, 0.42 - 0.03 * t, 0.18 + 0.18 * t];
  }

  // Rolling lush green meadows / plains
  return [0.22, 0.5, 0.18];
}

/**
 * Generates raw typed array buffers for flat plane terrain patch (worker-safe, 0-copy transferable).
 */
export function generateCdlodPlanePatchRawBuffers(
  sampler: ISurfaceSampler,
  address: IPlanePatchAddress,
  resolution: number,
  rootPatchSizeM: number,
  centerM: Vec3d,
  bodyId = 'home-planet',
): ICdlodRawPatchBuffers {
  const { minX, maxX, minZ, maxZ, spanM } = planePatchBounds(
    address,
    rootPatchSizeM,
  );

  const rowLength = resolution + 1;
  const vertexCount = rowLength * rowLength;

  const positions = new Float32Array(vertexCount * 3);
  const coarsePositions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const elevations = new Float32Array(vertexCount);

  const step = spanM / resolution;

  const extRes = resolution + 2;
  const extCount = extRes * extRes;
  const extCoords = new Float64Array(extCount * 3);

  for (let ey = 0; ey < extRes; ey++) {
    const z = minZ + (ey - 1) * step;
    for (let ex = 0; ex < extRes; ex++) {
      const x = minX + (ex - 1) * step;
      const off = (ey * extRes + ex) * 3;
      extCoords[off] = x;
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
    const wz = minZ + y * step;
    for (let x = 0; x <= resolution; x++) {
      const wx = minX + x * step;
      const vIndex = y * rowLength + x;
      const extIndex = (y + 1) * extRes + (x + 1);

      const elev = extElevations[extIndex];
      elevations[vIndex] = elev;

      const lx = wx - centerM[0];
      const ly = elev - centerM[1];
      const lz = wz - centerM[2];

      positions[vIndex * 3] = lx;
      positions[vIndex * 3 + 1] = ly;
      positions[vIndex * 3 + 2] = lz;

      // Odd/even morph snapping for CDLOD
      const isOddX = x % 2 !== 0;
      const isOddY = y % 2 !== 0;

      let cx = wx;
      let cy = elev;
      let cz = wz;

      if (isOddX && isOddY) {
        const i00 = y * extRes + x;
        const i10 = y * extRes + (x + 2);
        const i01 = (y + 2) * extRes + x;
        const i11 = (y + 2) * extRes + (x + 2);
        cy =
          (extElevations[i00] +
            extElevations[i10] +
            extElevations[i01] +
            extElevations[i11]) *
          0.25;
      } else if (isOddX) {
        const iLeft = (y + 1) * extRes + x;
        const iRight = (y + 1) * extRes + (x + 2);
        cy = (extElevations[iLeft] + extElevations[iRight]) * 0.5;
      } else if (isOddY) {
        const iBot = y * extRes + (x + 1);
        const iTop = (y + 2) * extRes + (x + 1);
        cy = (extElevations[iBot] + extElevations[iTop]) * 0.5;
      }

      coarsePositions[vIndex * 3] = cx - centerM[0];
      coarsePositions[vIndex * 3 + 1] = cy - centerM[1];
      coarsePositions[vIndex * 3 + 2] = cz - centerM[2];

      // Central difference normal
      const leftIdx = (y + 1) * extRes + x;
      const rightIdx = (y + 1) * extRes + (x + 2);
      const botIdx = y * extRes + (x + 1);
      const topIdx = (y + 2) * extRes + (x + 1);

      const dElevX = extElevations[rightIdx] - extElevations[leftIdx];
      const dElevZ = extElevations[topIdx] - extElevations[botIdx];

      let nx = -dElevX / (2 * step);
      let ny = 1.0;
      let nz = -dElevZ / (2 * step);

      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      normals[vIndex * 3] = nx;
      normals[vIndex * 3 + 1] = ny;
      normals[vIndex * 3 + 2] = nz;

      const slope = ny;
      const [cr, cg, cb] = computePlaneVertexColor(elev, slope, bodyId);

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
 * Synchronous BufferGeometry generator for Plane patch
 */
export function generateCdlodPlanePatchGeometry(
  sampler: ISurfaceSampler,
  address: IPlanePatchAddress,
  resolution: number,
  rootPatchSizeM: number,
  centerM: Vec3d,
  bodyId = 'home-planet',
): ICdlodMeshResult {
  const raw = generateCdlodPlanePatchRawBuffers(
    sampler,
    address,
    resolution,
    rootPatchSizeM,
    centerM,
    bodyId,
  );
  const geometry = reconstructCdlodBufferGeometry(raw);

  return {
    geometry,
    triangleCount: raw.triangleCount,
    minElevationM: raw.minElevationM,
    maxElevationM: raw.maxElevationM,
  };
}
