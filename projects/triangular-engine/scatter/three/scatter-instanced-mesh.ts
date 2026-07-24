import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Material,
} from 'three';

import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';
import {
  computeScatterInstanceMatrix,
  type ScatterScaleRange,
} from './scatter-instance-transform';

export interface IBuildScatterInstancedMeshOptions {
  readonly instances: readonly ITerrainScatterInstance[];
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
  readonly rules: ScatterPlacementRules;
  readonly scale: ScatterScaleRange;
  readonly anchorWorldM: readonly [number, number, number];
  readonly castShadow?: boolean;
}

/**
 * One InstancedMesh for one species/LOD tier — Phase 1's "one batch per
 * cell" is acceptable; rebuild wholesale when the instance set changes.
 * Render-batch merging and incremental updates are Phase 2 concerns.
 */
export function buildScatterInstancedMesh(
  options: IBuildScatterInstancedMeshOptions,
): InstancedMesh {
  const mesh = new InstancedMesh(
    options.geometry,
    options.material,
    options.instances.length,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = options.castShadow ?? false;
  for (let i = 0; i < options.instances.length; i++) {
    mesh.setMatrixAt(
      i,
      computeScatterInstanceMatrix(
        options.instances[i],
        options.rules,
        options.scale,
        options.anchorWorldM,
      ),
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = options.instances.length;
  return mesh;
}
