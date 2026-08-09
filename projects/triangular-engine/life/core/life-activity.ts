import type { LifeRouteActivity } from './life-deterministic-route';
import type { LifeVector3 } from './life-vector';

export interface LifeActivityTarget {
  readonly id: string;
  readonly activity: Exclude<LifeRouteActivity, 'travel'>;
  readonly position: LifeVector3;
  /** Species/season/resource suitability supplied by the world adapter. */
  readonly suitability01: number;
}

export interface LifeActivitySelectionOptions {
  readonly seed: number;
  readonly universalTimeSeconds: number;
  readonly minimumSuitability01?: number;
  /** How often the deterministic tie-breaker may change target preference. */
  readonly decisionPeriodSeconds?: number;
}

/**
 * Chooses a resource/activity target without hidden state. Suitability is the
 * world-provided signal; the stable hash only breaks ties and avoids every
 * group selecting the first meadow in the same UT bucket.
 */
export function chooseLifeActivityTarget(
  targets: readonly LifeActivityTarget[],
  options: LifeActivitySelectionOptions,
): LifeActivityTarget | null {
  const minimum = Math.max(0, Math.min(1, options.minimumSuitability01 ?? 0));
  const period = Math.max(1e-3, options.decisionPeriodSeconds ?? 3600);
  const bucket = Math.floor(options.universalTimeSeconds / period);
  const candidates = targets.filter((target) => Number.isFinite(target.suitability01)
    && target.suitability01 >= minimum);
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const candidateScore = candidate.suitability01 + stableJitter(options.seed, bucket, candidate.id) * 1e-4;
    const bestScore = best.suitability01 + stableJitter(options.seed, bucket, best.id) * 1e-4;
    return candidateScore > bestScore
      || (candidateScore === bestScore && candidate.id < best.id)
      ? candidate
      : best;
  });
}

function stableJitter(seed: number, bucket: number, id: string): number {
  let hash = (seed | 0) ^ Math.imul(bucket | 0, 0x45d9f3b);
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 0x27d4eb2d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}
