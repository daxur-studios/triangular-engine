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
  /**
   * Per-instance opacity for this tier's shader-side dither cross-fade,
   * keyed by instanceId. Instances absent from this map render fully
   * opaque (alpha 1) — only instances mid-transition into/out of an
   * adjacent tier (when `ditherBandM` is set) get a partial entry, and
   * such instances appear in both the outgoing and incoming tier's bucket
   * simultaneously so the two can cross-fade instead of popping.
   */
  readonly alpha01ByInstanceId: ReadonlyMap<ScatterInstanceId, number>;
}

export interface IScatterLodBucketingResult {
  /** Sorted by tierIndex ascending; tiers with no surviving instances are omitted. */
  readonly buckets: readonly IScatterLodBucket[];
  /** Each instance's "home" tier (post-hysteresis), independent of any dither duplication into an adjacent bucket — the right source for per-instance stats/hysteresis, unlike summing bucket lengths. */
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

interface IMutableBucket {
  readonly instances: ITerrainScatterInstance[];
  readonly alpha01ByInstanceId: Map<ScatterInstanceId, number>;
}

/**
 * Splits one species' instances into per-LOD-tier buckets so callers can
 * build one InstancedMesh per active tier. Hysteresis is applied per
 * instance via `previousTierByInstanceId`, not globally, so instances near
 * a boundary don't all flip on the same frame. Instances beyond every
 * tier's maxDistanceM are dropped, matching `selectScatterLodTier`.
 *
 * When `ditherBandM` is set, an instance mid-transition is pushed into
 * *both* its current tier's bucket (fading out) and the next tier's bucket
 * (fading in), each with a complementary `alpha01ByInstanceId` entry, so a
 * shader-side dither discard can cross-fade the two instead of popping.
 * The last tier never dithers this way — it still hard-culls at its
 * maxDistanceM, since there is no further tier to fade into.
 */
export function bucketScatterInstancesByLod(
  options: IBucketScatterInstancesByLodOptions,
): IScatterLodBucketingResult {
  const byTier = new Map<number, IMutableBucket>();
  const tierByInstanceId = new Map<ScatterInstanceId, number>();

  function bucketFor(tierIndex: number): IMutableBucket {
    let bucket = byTier.get(tierIndex);
    if (!bucket) {
      bucket = { instances: [], alpha01ByInstanceId: new Map() };
      byTier.set(tierIndex, bucket);
    }
    return bucket;
  }

  for (const instance of options.instances) {
    const distance = distanceM(instance.worldPositionM, options.viewpointWorldM);
    const selectionOptions: IScatterLodSelectionOptions = {
      previousTierIndex: options.previousTierByInstanceId?.get(instance.instanceId),
      hysteresisM: options.hysteresisM,
      ditherBandM: options.ditherBandM,
    };
    const { tierIndex, blend01 } = selectScatterLodTier(distance, options.lods, selectionOptions);
    if (tierIndex < 0) continue;

    tierByInstanceId.set(instance.instanceId, tierIndex);

    const hasNextTier = tierIndex + 1 < options.lods.length;
    const fadeOut01 = hasNextTier ? blend01 : 0;

    const currentBucket = bucketFor(tierIndex);
    currentBucket.instances.push(instance);
    if (fadeOut01 > 0) {
      currentBucket.alpha01ByInstanceId.set(instance.instanceId, 1 - fadeOut01);

      const nextBucket = bucketFor(tierIndex + 1);
      nextBucket.instances.push(instance);
      nextBucket.alpha01ByInstanceId.set(instance.instanceId, fadeOut01);
    }
  }

  const buckets: IScatterLodBucket[] = [];
  for (const [tierIndex, bucket] of byTier) {
    buckets.push({
      tierIndex,
      lod: options.lods[tierIndex],
      instances: bucket.instances,
      alpha01ByInstanceId: bucket.alpha01ByInstanceId,
    });
  }
  buckets.sort((a, b) => a.tierIndex - b.tierIndex);

  return { buckets, tierByInstanceId };
}
