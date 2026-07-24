import type { IScatterCandidate } from './scatter-candidate';
import type { ScatterPlacementRules } from './scatter-species-definition';

export type ScatterVector3 = readonly [number, number, number];

export interface IScatterSurfaceSample {
  readonly worldPositionM: ScatterVector3;
  /** Displaced surface normal at this point — used for align-to-normal. */
  readonly normal: ScatterVector3;
  /** Undisplaced "which way is up" reference — used for align-to-surface-up. */
  readonly surfaceUp: ScatterVector3;
  readonly slope01: number;
}

/** 0..1 multiplier on base density; 0 excludes the point entirely. */
export type ScatterSuitabilityFn = (sample: IScatterSurfaceSample) => number;

export type ScatterRejectionReason = 'slope' | 'density';

export interface IScatterPlacementResult {
  readonly accepted: boolean;
  readonly rejectionReason?: ScatterRejectionReason;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Decides whether one candidate becomes an instance. Resolving alignment and
 * embed depth into an actual transform is a rendering-layer concern (needs
 * quaternion math scatter/core doesn't own) — this only reads
 * rules.alignment/embedDepthM as data, it never returns a transform.
 */
export function evaluateScatterPlacement(
  candidate: Pick<IScatterCandidate, 'densitySeed01'>,
  sample: IScatterSurfaceSample,
  rules: ScatterPlacementRules,
  baseDensity01: number,
  suitability?: ScatterSuitabilityFn,
): IScatterPlacementResult {
  if (
    rules.slopeMin01 !== undefined &&
    sample.slope01 < rules.slopeMin01
  ) {
    return { accepted: false, rejectionReason: 'slope' };
  }
  if (
    rules.slopeMax01 !== undefined &&
    sample.slope01 > rules.slopeMax01
  ) {
    return { accepted: false, rejectionReason: 'slope' };
  }

  const suitability01 = suitability ? clamp01(suitability(sample)) : 1;
  const effectiveDensity01 = clamp01(baseDensity01) * suitability01;

  if (candidate.densitySeed01 >= effectiveDensity01) {
    return { accepted: false, rejectionReason: 'density' };
  }
  return { accepted: true };
}
