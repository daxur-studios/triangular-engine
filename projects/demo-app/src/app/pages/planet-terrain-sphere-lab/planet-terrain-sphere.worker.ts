/// <reference lib="webworker" />

import {
  generateTerrainPatchMesh,
  SphereTerrainDomain,
  type ISphereTerrainPatchAddress,
  type ITerrainSurfaceGenerationRequest,
} from 'triangular-engine/terrain';
import { PlanetTerrainField } from './planet-terrain-field';

interface PlanetTerrainWorkerRequest {
  readonly id: number;
  readonly address: ISphereTerrainPatchAddress;
  readonly radiusM: number;
  readonly baseResolution: number;
  readonly resolution: number;
  readonly edgeRefinementMask: number;
  readonly edgeRefinementLevel: number;
  readonly edgeRefinementLevels: readonly [number, number, number, number];
  readonly edgeRefinementSegments: ITerrainSurfaceGenerationRequest<ISphereTerrainPatchAddress>['edgeRefinementSegments'];
  readonly skirtDepthM: number;
}

const field = new PlanetTerrainField();

addEventListener(
  'message',
  ({ data }: MessageEvent<PlanetTerrainWorkerRequest>) => {
    try {
      const domain = new SphereTerrainDomain(data.radiusM);
      const request: ITerrainSurfaceGenerationRequest<ISphereTerrainPatchAddress> = {
        field,
        domain,
        address: data.address,
        baseResolution: data.baseResolution,
        resolution: data.resolution,
        edgeRefinementMask: data.edgeRefinementMask,
        edgeRefinementLevel: data.edgeRefinementLevel,
        edgeRefinementLevels: data.edgeRefinementLevels,
        edgeRefinementSegments: data.edgeRefinementSegments,
        skirtDepthM: data.skirtDepthM,
      };
      const patch = generateTerrainPatchMesh(field, domain, request);
      postMessage(
        { id: data.id, patch },
        [
          patch.surface.positions.buffer,
          patch.surface.normals.buffer,
          patch.surface.uvs.buffer,
          patch.surface.indices.buffer,
        ],
      );
    } catch (error) {
      postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
