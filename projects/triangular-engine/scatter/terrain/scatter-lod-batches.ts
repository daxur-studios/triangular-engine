import type { ScatterInstanceId } from '../core/scatter-instance-id';
import {
  selectScatterLodTier,
  type IScatterLodSelectionOptions,
} from '../core/scatter-lod-selection';
import type { ScatterLodDefinition } from '../core/scatter-species-definition';
import type { ITerrainScatterInstance } from './scatter-terrain-instances';

export interface IBucketScatterInstancesByLodOptions {
  readonly instances: readonly ITerrainScatterInstance[];
  readonly lods: readonly ScatterLodDefinition[];
  readonly viewpointWorldM: readonly [number, number, number];
  /** Feed back the previous frame's `tierByInstanceId` here so hysteresis persists per instance. */
  readonly previousTierByInstanceId?: ReadonlyMap<ScatterInstanceId, number>;
  readonly hysteresisM?: number;
  readonly ditherBandM?: number;
}

export interface IScatterLodBucket {
  readonly tierIndex: number;
  readonly lod: ScatterLodDefinition;
  readonly instances: readonly ITerrainScatterInstance[];
}

export interface IScatterLodBucketingResult {
  /** Sorted by tierIndex ascending; tiers with no surviving instances are omitted. */
  readonly buckets: readonly IScatterLodBucket[];
  readonly tierByInstanceId: ReadonlyMap<ScatterInstanceId, number>;
}

function distanceM(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Splits one species' instances into per-LOD-tier buckets so callers can
 * build one InstancedMesh per active tier. Hysteresis is applied per
 * instance via `previousTierByInstanceId`, not globally, so instances near
 * a boundary don't all flip on the same frame. Instances beyond every
 * tier's maxDistanceM are dropped, matching `selectScatterLodTier`.
 */
export function bucketScatterInstancesByLod(
  options: IBucketScatterInstancesByLodOptions,
): IScatterLodBucketingResult {
  const byTier = new Map<number, ITerrainScatterInstance[]>();
  const tierByInstanceId = new Map<ScatterInstanceId, number>();

  for (const instance of options.instances) {
    const distance = distanceM(instance.worldPositionM, options.viewpointWorldM);
    const selectionOptions: IScatterLodSelectionOptions = {
      previousTierIndex: options.previousTierByInstanceId?.get(instance.instanceId),
      hysteresisM: options.hysteresisM,
      ditherBandM: options.ditherBandM,
    };
    const { tierIndex } = selectScatterLodTier(distance, options.lods, selectionOptions);
    if (tierIndex < 0) continue;

    tierByInstanceId.set(instance.instanceId, tierIndex);
    let bucket = byTier.get(tierIndex);
    if (!bucket) {
      bucket = [];
      byTier.set(tierIndex, bucket);
    }
    bucket.push(instance);
  }

  const buckets: IScatterLodBucket[] = [];
  for (const [tierIndex, instances] of byTier) {
    buckets.push({ tierIndex, lod: options.lods[tierIndex], instances });
  }
  buckets.sort((a, b) => a.tierIndex - b.tierIndex);

  return { buckets, tierByInstanceId };
}
