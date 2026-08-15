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
import { SCATTER_INSTANCE_IDS_USERDATA_KEY } from './scatter-instance-picking';
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
  /**
   * three.js frustum-culls a whole InstancedMesh against one bounding
   * sphere — the raw geometry's local bounds transformed only by the
   * object's own matrixWorld (see Frustum.intersectsObject); it has no
   * idea individual instances are spread across the terrain via
   * instanceMatrix. Left enabled, the entire batch can vanish in one shot
   * from angles where that single (tiny, origin-anchored) sphere happens
   * to miss the frustum, e.g. steep top-down views.
   */
  mesh.frustumCulled = false;

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
  mesh.userData[SCATTER_INSTANCE_IDS_USERDATA_KEY] = options.instances.map(
    (instance) => instance.instanceId,
  );

  if (ditherAlpha) {
    options.geometry.setAttribute(
      SCATTER_DITHER_ALPHA_ATTRIBUTE,
      new InstancedBufferAttribute(ditherAlpha, 1),
    );
  }

  return mesh;
}
