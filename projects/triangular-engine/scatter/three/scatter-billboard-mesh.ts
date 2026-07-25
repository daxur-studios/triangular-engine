import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
} from 'three';

import type { ScatterInstanceId } from '../core/scatter-instance-id';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import { SCATTER_INSTANCE_IDS_USERDATA_KEY } from './scatter-instance-picking';
import type { ScatterScaleRange } from './scatter-instance-transform';
import { SCATTER_DITHER_ALPHA_ATTRIBUTE } from './scatter-instanced-mesh';

/** Anchor-relative world position; read by `enableScatterCylindricalBillboard` instead of a baked rotation, since a billboard's orientation is recomputed every frame from the live camera. */
export const SCATTER_BILLBOARD_ORIGIN_ATTRIBUTE = 'instanceOriginM';
export const SCATTER_BILLBOARD_SCALE_ATTRIBUTE = 'instanceScale';
export const SCATTER_BILLBOARD_SURFACE_UP_ATTRIBUTE = 'instanceSurfaceUp';

export interface IBuildScatterBillboardInstancedMeshOptions {
  readonly instances: readonly ITerrainScatterInstance[];
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
  readonly scale: ScatterScaleRange;
  readonly anchorWorldM: readonly [number, number, number];
  readonly castShadow?: boolean;
  /** Per-instance opacity for a dither cross-fade; instances absent from the map default to 1 (fully opaque). Omit entirely to skip writing the attribute. */
  readonly alpha01ByInstanceId?: ReadonlyMap<ScatterInstanceId, number>;
}

const IDENTITY_MATRIX = new Matrix4();

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/**
 * Builds a cylindrical-billboard InstancedMesh: `instanceMatrix` is left
 * identity for every instance (so the standard `USE_INSTANCING` transform
 * in three.js's `project_vertex` chunk is a no-op) and position/scale/up
 * are instead carried on dedicated per-instance attributes that
 * `enableScatterCylindricalBillboard`'s shader patch reads to re-orient the
 * quad toward the camera every frame. A baked rotation (like
 * `buildScatterInstancedMesh` writes) would fight that per-frame
 * recomputation, hence the separate attribute set instead of reusing
 * `computeScatterInstanceMatrix`.
 */
export function buildScatterBillboardInstancedMesh(
  options: IBuildScatterBillboardInstancedMeshOptions,
): InstancedMesh {
  const mesh = new InstancedMesh(
    options.geometry,
    options.material,
    options.instances.length,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = options.castShadow ?? false;

  const count = options.instances.length;
  const origins = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const ups = new Float32Array(count * 3);
  const ditherAlpha = options.alpha01ByInstanceId ? new Float32Array(count) : undefined;

  for (let i = 0; i < count; i++) {
    const instance = options.instances[i];
    mesh.setMatrixAt(i, IDENTITY_MATRIX);

    origins[i * 3] = instance.worldPositionM[0] - options.anchorWorldM[0];
    origins[i * 3 + 1] = instance.worldPositionM[1] - options.anchorWorldM[1];
    origins[i * 3 + 2] = instance.worldPositionM[2] - options.anchorWorldM[2];

    scales[i] = lerp(options.scale.min, options.scale.max, instance.scaleSeed01);

    ups[i * 3] = instance.surfaceUp[0];
    ups[i * 3 + 1] = instance.surfaceUp[1];
    ups[i * 3 + 2] = instance.surfaceUp[2];

    if (ditherAlpha) {
      ditherAlpha[i] = options.alpha01ByInstanceId?.get(instance.instanceId) ?? 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = count;
  mesh.userData[SCATTER_INSTANCE_IDS_USERDATA_KEY] = options.instances.map(
    (instance) => instance.instanceId,
  );

  options.geometry.setAttribute(
    SCATTER_BILLBOARD_ORIGIN_ATTRIBUTE,
    new InstancedBufferAttribute(origins, 3),
  );
  options.geometry.setAttribute(
    SCATTER_BILLBOARD_SCALE_ATTRIBUTE,
    new InstancedBufferAttribute(scales, 1),
  );
  options.geometry.setAttribute(
    SCATTER_BILLBOARD_SURFACE_UP_ATTRIBUTE,
    new InstancedBufferAttribute(ups, 3),
  );
  if (ditherAlpha) {
    options.geometry.setAttribute(
      SCATTER_DITHER_ALPHA_ATTRIBUTE,
      new InstancedBufferAttribute(ditherAlpha, 1),
    );
  }

  return mesh;
}
