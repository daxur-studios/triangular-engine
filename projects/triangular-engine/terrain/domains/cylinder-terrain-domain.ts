import type { TerrainVector3 } from '../core/terrain-math';
import type {
  ITerrainPatchBounds,
  ITerrainSurfaceDomain,
} from './terrain-surface-domain';

export interface ICylinderTerrainPatchAddress {
  readonly level: number;
  readonly angularIndex: number;
  readonly axialIndex: number;
}

export interface ICylinderTerrainDomainOptions {
  readonly radiusM: number;
  readonly lengthM: number;
  readonly levelZeroAngularPatchCount?: number;
  readonly levelZeroAxialPatchCount?: number;
}

const MAX_CYLINDER_TERRAIN_LEVEL = 24;

/** Finite cylinder wall with a periodic angular axis and inward elevation. */
export class CylinderTerrainDomain
  implements ITerrainSurfaceDomain<ICylinderTerrainPatchAddress>
{
  readonly kind = 'cylinder';
  readonly radiusM: number;
  readonly lengthM: number;
  readonly levelZeroAngularPatchCount: number;
  readonly levelZeroAxialPatchCount: number;

  constructor(options: ICylinderTerrainDomainOptions) {
    this.radiusM = options.radiusM;
    this.lengthM = options.lengthM;
    this.levelZeroAngularPatchCount =
      options.levelZeroAngularPatchCount ?? 8;
    this.levelZeroAxialPatchCount = options.levelZeroAxialPatchCount ?? 4;
    if (!Number.isFinite(this.radiusM) || this.radiusM <= 0) {
      throw new RangeError('Cylinder terrain radius must be positive and finite.');
    }
    if (!Number.isFinite(this.lengthM) || this.lengthM <= 0) {
      throw new RangeError('Cylinder terrain length must be positive and finite.');
    }
    if (
      !Number.isInteger(this.levelZeroAngularPatchCount) ||
      this.levelZeroAngularPatchCount < 3 ||
      !Number.isInteger(this.levelZeroAxialPatchCount) ||
      this.levelZeroAxialPatchCount < 1
    ) {
      throw new RangeError(
        'Cylinder terrain base patch counts must be integers (angular >= 3, axial >= 1).',
      );
    }
  }

  getPatchCounts(level: number): {
    readonly angular: number;
    readonly axial: number;
  } {
    this.validateLevel(level);
    const scale = 2 ** level;
    return {
      angular: this.levelZeroAngularPatchCount * scale,
      axial: this.levelZeroAxialPatchCount * scale,
    };
  }

  getPatchBounds(
    address: ICylinderTerrainPatchAddress,
  ): ITerrainPatchBounds {
    this.validateAddress(address);
    const counts = this.getPatchCounts(address.level);
    const axialSpan = this.lengthM / counts.axial;
    const angularSpan = (Math.PI * 2) / counts.angular;
    return {
      // U is axial and V angular so increasing U x increasing V faces inward.
      minU: -this.lengthM / 2 + address.axialIndex * axialSpan,
      maxU: -this.lengthM / 2 + (address.axialIndex + 1) * axialSpan,
      minV: address.angularIndex * angularSpan,
      maxV: (address.angularIndex + 1) * angularSpan,
    };
  }

  getFieldPosition(
    address: ICylinderTerrainPatchAddress,
    axialM: number,
    angle: number,
  ): TerrainVector3 {
    this.validateAddress(address);
    return [axialM, Math.cos(angle), Math.sin(angle)];
  }

  getSurfacePosition(
    address: ICylinderTerrainPatchAddress,
    axialM: number,
    angle: number,
    elevationM: number,
  ): TerrainVector3 {
    this.validateAddress(address);
    const displacedRadius = this.radiusM - elevationM;
    return [
      axialM,
      Math.cos(angle) * displacedRadius,
      Math.sin(angle) * displacedRadius,
    ];
  }

  getGeometricErrorM(
    address: ICylinderTerrainPatchAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number {
    const bounds = this.getPatchBounds(address);
    const cellAngle = (bounds.maxV - bounds.minV) / resolution;
    const curvatureError =
      (this.radiusM - minElevationM) * (1 - Math.cos(cellAngle / 2));
    return maxElevationM - minElevationM + curvatureError;
  }

  getChildren(
    address: ICylinderTerrainPatchAddress,
  ): readonly ICylinderTerrainPatchAddress[] {
    this.validateAddress(address);
    const level = address.level + 1;
    if (level > MAX_CYLINDER_TERRAIN_LEVEL) {
      throw new RangeError('Cylinder terrain patch has reached maximum level.');
    }
    const angularIndex = address.angularIndex * 2;
    const axialIndex = address.axialIndex * 2;
    return [
      { level, angularIndex, axialIndex },
      { level, angularIndex: angularIndex + 1, axialIndex },
      { level, angularIndex, axialIndex: axialIndex + 1 },
      { level, angularIndex: angularIndex + 1, axialIndex: axialIndex + 1 },
    ];
  }

  getNeighbor(
    address: ICylinderTerrainPatchAddress,
    angularOffset: number,
    axialOffset: number,
  ): ICylinderTerrainPatchAddress | null {
    this.validateAddress(address);
    if (!Number.isInteger(angularOffset) || !Number.isInteger(axialOffset)) {
      throw new RangeError('Cylinder terrain neighbor offsets must be integers.');
    }
    const counts = this.getPatchCounts(address.level);
    const axialIndex = address.axialIndex + axialOffset;
    if (axialIndex < 0 || axialIndex >= counts.axial) return null;
    return {
      level: address.level,
      angularIndex:
        (address.angularIndex + angularOffset + counts.angular) % counts.angular,
      axialIndex,
    };
  }

  private validateLevel(level: number): void {
    if (
      !Number.isInteger(level) ||
      level < 0 ||
      level > MAX_CYLINDER_TERRAIN_LEVEL
    ) {
      throw new RangeError('Cylinder terrain level is outside its valid range.');
    }
  }

  private validateAddress(address: ICylinderTerrainPatchAddress): void {
    this.validateLevel(address.level);
    const counts = this.getPatchCounts(address.level);
    if (
      !Number.isInteger(address.angularIndex) ||
      !Number.isInteger(address.axialIndex) ||
      address.angularIndex < 0 ||
      address.angularIndex >= counts.angular ||
      address.axialIndex < 0 ||
      address.axialIndex >= counts.axial
    ) {
      throw new RangeError(
        'Cylinder terrain address must identify a valid periodic-wall tile.',
      );
    }
  }
}
