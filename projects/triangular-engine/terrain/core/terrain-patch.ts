import { TerrainVector3 } from './terrain-math';

/** Index storage selected according to generated patch vertex count. */
export type TerrainPatchIndexArray = Uint16Array | Uint32Array;

/** Transferable patch geometry with no renderer or physics ownership. */
export interface ITerrainPatchGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: TerrainPatchIndexArray;
}

/** Patch-local mesh shared by visual and future collider consumers. */
export interface ITerrainPatchMesh<TAddress> {
  address: TAddress;
  resolution: number;
  centerWorldM: TerrainVector3;
  surface: ITerrainPatchGeometry;
  /** Kept separate so physics never consumes visual seam-hiding geometry. */
  skirt?: ITerrainPatchGeometry;
  geometricErrorM: number;
}
