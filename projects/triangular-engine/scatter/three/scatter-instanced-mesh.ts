import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
} from 'three';

import type { ScatterInstanceId } from '../core/scatter-instance-id';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';
import {
  computeScatterInstanceMatrix,
  type ScatterScaleRange,
} from './scatter-instance-transform';

/** Per-instance attribute name the dither cross-fade shader patch (`enableScatterDitherFade`) reads opacity from. */
export const SCATTER_DITHER_ALPHA_ATTRIBUTE = 'instanceDitherAlpha';

export interface IBuildScatterInstancedMeshOptions {
  readonly instances: readonly ITerrainScatterInstance[];
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
  readonly rules: ScatterPlacementRules;
  readonly scale: ScatterScaleRange;
  readonly anchorWorldM: readonly [number, number, number];
  readonly castShadow?: boolean;
  /** Per-instance opacity for a dither cross-fade; instances absent from the map default to 1 (fully opaque). Omit entirely to skip writing the attribute for materials that don't need it (e.g. grass). */
  readonly alpha01ByInstanceId?: ReadonlyMap<ScatterInstanceId, number>;
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

  const ditherAlpha = options.alpha01ByInstanceId
    ? new Float32Array(options.instances.length)
    : undefined;

  for (let i = 0; i < options.instances.length; i++) {
    const instance = options.instances[i];
    mesh.setMatrixAt(
      i,
      computeScatterInstanceMatrix(
        instance,
        options.rules,
        options.scale,
        options.anchorWorldM,
      ),
    );
    if (ditherAlpha) {
      ditherAlpha[i] = options.alpha01ByInstanceId?.get(instance.instanceId) ?? 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = options.instances.length;

  if (ditherAlpha) {
    options.geometry.setAttribute(
      SCATTER_DITHER_ALPHA_ATTRIBUTE,
      new InstancedBufferAttribute(ditherAlpha, 1),
    );
  }

  return mesh;
}
