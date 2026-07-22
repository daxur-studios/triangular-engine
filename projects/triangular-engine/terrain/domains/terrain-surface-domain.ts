import type { ITerrainField } from '../core/terrain-field';
import { TerrainVector3 } from '../core/terrain-math';

/** Parametric bounds occupied by one rectangular terrain patch. */
export interface ITerrainPatchBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/**
 * Shape-specific mapping boundary for the generic terrain mesher.
 * Increasing U crossed with increasing V must face the inhabited/visible side.
 */
export interface ITerrainSurfaceDomain<TAddress> {
  readonly kind: string;
  getPatchBounds(address: TAddress): ITerrainPatchBounds;
  /** Maps domain coordinates into continuous procedural-field space. */
  getFieldPosition(address: TAddress, u: number, v: number): TerrainVector3;
  /** Maps coordinates and positive terrain elevation into world space. */
  getSurfacePosition(
    address: TAddress,
    u: number,
    v: number,
    elevationM: number,
  ): TerrainVector3;
  /** Optional domain-owned normal sampling for topology boundaries. */
  getSurfaceNormal?(
    field: ITerrainField,
    address: TAddress,
    u: number,
    v: number,
    stepU: number,
    stepV: number,
  ): TerrainVector3;
  /** Conservative domain-specific geometric error for LOD selection. */
  getGeometricErrorM(
    address: TAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number;
}

/** Quadtree-capable domain used by the shared view-driven patch selector. */
export interface IHierarchicalTerrainSurfaceDomain<
  TAddress,
> extends ITerrainSurfaceDomain<TAddress> {
  getChildren(address: TAddress): readonly TAddress[];
}
