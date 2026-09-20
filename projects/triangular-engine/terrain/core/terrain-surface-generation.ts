import type { ITerrainField } from './terrain-field';
import type { TerrainPatchEdgeSegments, ITerrainPatchMesh } from './terrain-patch';
import type { IHierarchicalTerrainSurfaceDomain } from './terrain-surface-domain';

/** Framework-free request contract for generating one adaptive terrain patch. */
export interface ITerrainSurfaceGenerationRequest<TAddress> {
  readonly field: ITerrainField;
  readonly domain: IHierarchicalTerrainSurfaceDomain<TAddress>;
  readonly address: TAddress;
  readonly baseResolution: number;
  readonly resolution: number;
  readonly edgeRefinementMask: number;
  readonly edgeRefinementLevel: number;
  readonly edgeRefinementLevels: readonly [number, number, number, number];
  readonly edgeRefinementSegments: TerrainPatchEdgeSegments;
  readonly skirtDepthM: number;
}

/** Framework-free terrain patch generator callback used by render adapters. */
export type TerrainSurfaceMeshGenerator<TAddress> = (
  request: ITerrainSurfaceGenerationRequest<TAddress>,
) => ITerrainPatchMesh<TAddress> | Promise<ITerrainPatchMesh<TAddress>>;
