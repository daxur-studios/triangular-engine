import { BufferGeometry, InstancedMesh, Material } from 'three';

import type { IScatterLodBucket } from '../terrain/scatter-lod-batches';
import type {
  ScatterLodDefinition,
  ScatterPlacementRules,
} from '../core/scatter-species-definition';
import { buildScatterInstancedMesh } from './scatter-instanced-mesh';
import type { ScatterScaleRange } from './scatter-instance-transform';

export interface IScatterLodAssets {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

export interface IBuildScatterInstancedMeshesByLodOptions {
  readonly buckets: readonly IScatterLodBucket[];
  /** Resolves the geometry/material for one tier — e.g. full mesh vs. billboard quad. */
  readonly assetsByTier: (
    tierIndex: number,
    lod: ScatterLodDefinition,
  ) => IScatterLodAssets;
  readonly rules: ScatterPlacementRules;
  readonly scale: ScatterScaleRange;
  readonly anchorWorldM: readonly [number, number, number];
}

export interface IScatterLodInstancedMesh {
  readonly tierIndex: number;
  readonly lod: ScatterLodDefinition;
  readonly mesh: InstancedMesh;
}

/**
 * Builds one InstancedMesh per LOD bucket, each with its own tier's
 * assets and `castShadow` flag — mirrors the single-tier
 * `buildScatterInstancedMesh` but fans it out across a species' LOD ladder.
 */
export function buildScatterInstancedMeshesByLod(
  options: IBuildScatterInstancedMeshesByLodOptions,
): readonly IScatterLodInstancedMesh[] {
  return options.buckets.map((bucket) => {
    const assets = options.assetsByTier(bucket.tierIndex, bucket.lod);
    const mesh = buildScatterInstancedMesh({
      instances: bucket.instances,
      geometry: assets.geometry,
      material: assets.material,
      rules: options.rules,
      scale: options.scale,
      anchorWorldM: options.anchorWorldM,
      castShadow: bucket.lod.castShadow,
    });
    return { tierIndex: bucket.tierIndex, lod: bucket.lod, mesh };
  });
}
