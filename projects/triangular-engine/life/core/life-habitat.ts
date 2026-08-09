import type { LifeVector3 } from './life-vector';

/** A coarse classification supplied by the game world's terrain/biome system. */
export type LifeHabitatKind = string;

export interface LifeHabitatSample {
  readonly kind: LifeHabitatKind;
  readonly surfaceY: number;
  /** 0 means unusable, 1 means ideal for the queried species. */
  readonly suitability01: number;
}

/** Adapter boundary between the generic life simulation and a game world. */
export interface LifeHabitatQuery {
  sampleHabitat(position: LifeVector3, universalTimeSeconds?: number): LifeHabitatSample;
}

/**
 * Checks the whole movement segment, not just its endpoint. This prevents a
 * fast or time-warped agent from tunnelling through a thin invalid region.
 */
export function canTraverseLifeSegment(
  query: LifeHabitatQuery,
  from: LifeVector3,
  to: LifeVector3,
  allowedKinds: readonly LifeHabitatKind[],
  samples = 6,
  universalTimeSeconds = 0,
): boolean {
  const count = Math.max(1, Math.floor(samples));
  for (let index = 1; index <= count; index++) {
    const blend = index / count;
    const sample = query.sampleHabitat({
      x: from.x + (to.x - from.x) * blend,
      y: from.y + (to.y - from.y) * blend,
      z: from.z + (to.z - from.z) * blend,
    }, universalTimeSeconds);
    if (!allowedKinds.includes(sample.kind) || sample.suitability01 <= 0) return false;
  }
  return true;
}
