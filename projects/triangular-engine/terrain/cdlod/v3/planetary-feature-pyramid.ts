import {
  CubeFaceId,
  CDLOD_CUBE_FACES,
  faceUvToDirection,
  IPlanetPatchAddress,
  planetPatchUvBounds,
} from '../cdlod-quadtree';
import { ICelestialBody, ISurfaceSampler, Vec3d } from 'triangular-engine/celestial';

export const PYRAMID_FLAG_COASTLINE = 1 << 0;
export const PYRAMID_FLAG_RIDGE = 1 << 1;
export const PYRAMID_FLAG_OCEAN_ONLY = 1 << 2;
export const PYRAMID_FLAG_LAND_ONLY = 1 << 3;
export const PYRAMID_FLAG_MODIFIED = 1 << 4;

export interface IFeatureNodeData {
  minElevationM: number;
  maxElevationM: number;
  varianceM: number;
  flags: number;
  centerDirection: Vec3d;
  boundingRadiusM: number;
}

export interface IPlanetaryPyramidOptions {
  maxLevel?: number;
  samplesPerSide?: number;
}

/**
 * Pre-computed compact quadtree pyramid holding elevation extrema, geometric variance,
 * and terrain feature classifications (coastline, ridge, ocean, land).
 *
 * Allows the LOD selector to make instantaneous O(1) decisions without running
 * procedural noise functions on the CPU during traversal.
 */
export class PlanetaryFeaturePyramid {
  readonly body: ICelestialBody;
  readonly maxLevel: number;
  readonly nodesPerFace: number;
  private readonly levelOffsets: Int32Array;

  // Packed binary feature buffers
  private readonly minElevations: Float32Array;
  private readonly maxElevations: Float32Array;
  private readonly variances: Float32Array;
  private readonly flags: Uint8Array;

  constructor(
    body: ICelestialBody,
    sampler: ISurfaceSampler,
    options?: IPlanetaryPyramidOptions,
  ) {
    this.body = body;
    this.maxLevel = options?.maxLevel ?? 7;
    const samplesPerSide = options?.samplesPerSide ?? 5; // 5x5 = 25 samples per quad

    // Calculate level offsets
    let totalPerFace = 0;
    this.levelOffsets = new Int32Array(this.maxLevel + 1);
    for (let lvl = 0; lvl <= this.maxLevel; lvl++) {
      this.levelOffsets[lvl] = totalPerFace;
      totalPerFace += 1 << (lvl * 2);
    }
    this.nodesPerFace = totalPerFace;
    const totalNodes = totalPerFace * 6;

    this.minElevations = new Float32Array(totalNodes);
    this.maxElevations = new Float32Array(totalNodes);
    this.variances = new Float32Array(totalNodes);
    this.flags = new Uint8Array(totalNodes);

    this.#buildPyramid(sampler, samplesPerSide);
  }

  private getNodeIndex(face: CubeFaceId, level: number, x: number, y: number): number {
    const fIdx = CDLOD_CUBE_FACES.indexOf(face);
    if (fIdx < 0 || level > this.maxLevel) return -1;
    const gridDim = 1 << level;
    if (x < 0 || x >= gridDim || y < 0 || y >= gridDim) return -1;
    return fIdx * this.nodesPerFace + this.levelOffsets[level] + y * gridDim + x;
  }

  /**
   * Fast O(1) query for pre-computed feature node data.
   */
  getNode(address: IPlanetPatchAddress): IFeatureNodeData | null {
    const idx = this.getNodeIndex(address.face, address.level, address.x, address.y);
    if (idx < 0) return null;

    const minElev = this.minElevations[idx];
    const maxElev = this.maxElevations[idx];
    const variance = this.variances[idx];
    const nodeFlags = this.flags[idx];

    const bounds = planetPatchUvBounds(address);
    const midU = (bounds.minU + bounds.maxU) * 0.5;
    const midV = (bounds.minV + bounds.maxV) * 0.5;
    const centerDir = faceUvToDirection(address.face, midU, midV);

    // Approximate bounding sphere radius for the patch
    const halfWidthUv = (bounds.maxU - bounds.minU) * 0.5;
    const cornerDir = faceUvToDirection(address.face, bounds.maxU, bounds.maxV);
    const chordDist = Math.hypot(
      cornerDir[0] - centerDir[0],
      cornerDir[1] - centerDir[1],
      cornerDir[2] - centerDir[2],
    );
    const maxRadius = this.body.radiusM + Math.max(0, maxElev);
    const boundingRadiusM = chordDist * maxRadius + (maxElev - minElev) * 0.5;

    return {
      minElevationM: minElev,
      maxElevationM: maxElev,
      varianceM: variance,
      flags: nodeFlags,
      centerDirection: centerDir,
      boundingRadiusM,
    };
  }

  /**
   * Direct fast primitives access for tight loops.
   */
  getVarianceM(face: CubeFaceId, level: number, x: number, y: number): number {
    const idx = this.getNodeIndex(face, level, x, y);
    return idx >= 0 ? this.variances[idx] : 0;
  }

  getMinElevationM(face: CubeFaceId, level: number, x: number, y: number): number {
    const idx = this.getNodeIndex(face, level, x, y);
    return idx >= 0 ? this.minElevations[idx] : 0;
  }

  getMaxElevationM(face: CubeFaceId, level: number, x: number, y: number): number {
    const idx = this.getNodeIndex(face, level, x, y);
    return idx >= 0 ? this.maxElevations[idx] : 0;
  }

  getFlags(face: CubeFaceId, level: number, x: number, y: number): number {
    const idx = this.getNodeIndex(face, level, x, y);
    return idx >= 0 ? this.flags[idx] : 0;
  }

  isCoastline(face: CubeFaceId, level: number, x: number, y: number): boolean {
    const f = this.getFlags(face, level, x, y);
    return (f & PYRAMID_FLAG_COASTLINE) !== 0;
  }

  #buildPyramid(sampler: ISurfaceSampler, samplesPerSide: number): void {
    const seaLevelM = this.body.terrain?.ocean?.seaLevelM ?? 0;
    const hasOcean = !!this.body.terrain?.ocean;
    const step = 1.0 / (samplesPerSide - 1);

    for (let f = 0; f < 6; f++) {
      const face = CDLOD_CUBE_FACES[f];
      for (let lvl = 0; lvl <= this.maxLevel; lvl++) {
        const gridDim = 1 << lvl;
        const patchUvSpan = 2.0 / gridDim;

        for (let y = 0; y < gridDim; y++) {
          const minV = -1.0 + y * patchUvSpan;
          for (let x = 0; x < gridDim; x++) {
            const minU = -1.0 + x * patchUvSpan;
            const idx = f * this.nodesPerFace + this.levelOffsets[lvl] + y * gridDim + x;

            let minE = Infinity;
            let maxE = -Infinity;
            let sumE = 0;
            let sampleCount = 0;

            for (let sy = 0; sy < samplesPerSide; sy++) {
              const v = minV + sy * step * patchUvSpan;
              for (let sx = 0; sx < samplesPerSide; sx++) {
                const u = minU + sx * step * patchUvSpan;
                const dir = faceUvToDirection(face, u, v);
                const elev = sampler.sample(dir).elevationM;

                if (elev < minE) minE = elev;
                if (elev > maxE) maxE = elev;
                sumE += elev;
                sampleCount++;
              }
            }

            const variance = maxE - minE;
            let flag = 0;

            if (hasOcean) {
              if (minE <= seaLevelM + 2.0 && maxE >= seaLevelM - 2.0) {
                flag |= PYRAMID_FLAG_COASTLINE;
              }
              if (maxE < seaLevelM - 15.0) {
                flag |= PYRAMID_FLAG_OCEAN_ONLY;
              }
              if (minE > seaLevelM + 15.0) {
                flag |= PYRAMID_FLAG_LAND_ONLY;
              }
            }

            if (variance > 400.0) {
              flag |= PYRAMID_FLAG_RIDGE;
            }

            this.minElevations[idx] = minE;
            this.maxElevations[idx] = maxE;
            this.variances[idx] = variance;
            this.flags[idx] = flag;
          }
        }
      }
    }
  }

  /**
   * Approximate memory footprint in bytes.
   */
  get byteLength(): number {
    return (
      this.minElevations.byteLength +
      this.maxElevations.byteLength +
      this.variances.byteLength +
      this.flags.byteLength +
      this.levelOffsets.byteLength
    );
  }
}
