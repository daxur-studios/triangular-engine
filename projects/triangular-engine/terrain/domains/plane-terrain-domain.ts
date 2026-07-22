import { TerrainVector3 } from '../core/terrain-math';
import {
  ITerrainPatchBounds,
  ITerrainSurfaceDomain,
} from './terrain-surface-domain';

export interface IPlaneTerrainPatchAddress {
  /** Zero is the coarsest supported level; each level doubles resolution. */
  readonly level: number;
  readonly x: number;
  readonly z: number;
}

/** Infinite X/Z terrain tiled independently at every quadtree level. */
export class PlaneTerrainDomain implements ITerrainSurfaceDomain<IPlaneTerrainPatchAddress> {
  readonly kind = 'plane';

  constructor(readonly levelZeroPatchSizeM = 1_024) {
    if (!Number.isFinite(levelZeroPatchSizeM) || levelZeroPatchSizeM <= 0) {
      throw new RangeError(
        'Plane terrain patch size must be positive and finite.',
      );
    }
  }

  getPatchSizeM(address: IPlaneTerrainPatchAddress): number {
    this.validateAddress(address);
    return this.levelZeroPatchSizeM / 2 ** address.level;
  }

  getPatchBounds(address: IPlaneTerrainPatchAddress): ITerrainPatchBounds {
    const size = this.getPatchSizeM(address);
    return {
      minU: address.x * size,
      maxU: (address.x + 1) * size,
      minV: address.z * size,
      maxV: (address.z + 1) * size,
    };
  }

  getFieldPosition(
    _address: IPlaneTerrainPatchAddress,
    u: number,
    v: number,
  ): TerrainVector3 {
    return [u, 0, -v];
  }

  getSurfacePosition(
    _address: IPlaneTerrainPatchAddress,
    u: number,
    v: number,
    elevationM: number,
  ): TerrainVector3 {
    // U x V faces +Y while patch address z still follows world-space Z.
    return [u, elevationM, -v];
  }

  getGeometricErrorM(
    address: IPlaneTerrainPatchAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number {
    return (
      maxElevationM - minElevationM + this.getPatchSizeM(address) / resolution
    );
  }

  getChildren(
    address: IPlaneTerrainPatchAddress,
  ): readonly IPlaneTerrainPatchAddress[] {
    this.validateAddress(address);
    const level = address.level + 1;
    const x = address.x * 2;
    const z = address.z * 2;
    return [
      { level, x, z },
      { level, x: x + 1, z },
      { level, x, z: z + 1 },
      { level, x: x + 1, z: z + 1 },
    ];
  }

  private validateAddress(address: IPlaneTerrainPatchAddress): void {
    if (
      !Number.isInteger(address.level) ||
      address.level < 0 ||
      !Number.isSafeInteger(address.x) ||
      !Number.isSafeInteger(address.z)
    ) {
      throw new RangeError(
        'Plane terrain address must contain a non-negative level and safe integer coordinates.',
      );
    }
  }
}
