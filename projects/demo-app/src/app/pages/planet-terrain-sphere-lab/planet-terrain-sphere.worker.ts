/// <reference lib="webworker" />

import { BufferAttribute, BufferGeometry } from 'three';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  generateTerrainPatchMesh,
  SphereTerrainDomain,
  type ISphereTerrainPatchAddress,
  type ITerrainPatchMesh,
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
  readonly reduction: number;
  readonly targetError: number;
}

const field = new PlanetTerrainField();

function createGeometry(
  patch: ITerrainPatchMesh<ISphereTerrainPatchAddress>,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(patch.surface.uvs, 2));
  geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
  return geometry;
}

function compactSimplifiedGeometry(geometry: BufferGeometry): ITerrainPatchMesh<ISphereTerrainPatchAddress>['surface'] {
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!index || !position || !normal || !uv)
    throw new Error('Sphere terrain simplification returned incomplete geometry.');

  const remap = new Map<number, number>();
  const indices = new Uint32Array(index.count);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let indexOffset = 0; indexOffset < index.count; indexOffset += 1) {
    const sourceIndex = Number(index.array[indexOffset]);
    let compactIndex = remap.get(sourceIndex);
    if (compactIndex === undefined) {
      compactIndex = remap.size;
      remap.set(sourceIndex, compactIndex);
      for (let axis = 0; axis < 3; axis += 1) {
        positions.push(position.getComponent(sourceIndex, axis));
        normals.push(normal.getComponent(sourceIndex, axis));
      }
      for (let axis = 0; axis < 2; axis += 1)
        uvs.push(uv.getComponent(sourceIndex, axis));
    }
    indices[indexOffset] = compactIndex;
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: remap.size <= 65_535 ? new Uint16Array(indices) : indices,
  };
}

addEventListener(
  'message',
  async ({ data }: MessageEvent<PlanetTerrainWorkerRequest>) => {
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
      const generated = generateTerrainPatchMesh(field, domain, request);
      const sourceGeometry = createGeometry(generated);
      const simplified = await simplifyIndexedGeometry(sourceGeometry, {
        ratio: data.reduction,
        targetError: data.targetError,
        flags: ['LockBorder'],
      });
      const surface = compactSimplifiedGeometry(simplified.geometry);
      sourceGeometry.dispose();
      simplified.geometry.dispose();
      const patch = { ...generated, surface };
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
