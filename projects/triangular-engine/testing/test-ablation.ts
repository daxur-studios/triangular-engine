import { summarizeTestSamples } from './test-session';

/** `A` is the baseline, `B` has the feature on. */
export type AblationArm = 'A' | 'B';
/** Which per-round number represents a round: the typical frame or the slow tail. */
export type AblationStatistic = 'median' | 'p95';
/**
 * `rejected`: an arm drifted too much between its own rounds, so no difference can be trusted.
 * `invalid`: the input cannot be compared at all (see `reasons`).
 * `faster` / `slower`: B against A, for a metric where lower is better (a time).
 */
export type AblationVerdict = 'faster' | 'slower' | 'no-difference' | 'rejected' | 'invalid';

/** One measured round of one arm. Rounds are given in the order they ran. */
export interface AblationRound {
  readonly arm: AblationArm;
  readonly samples: readonly number[];
}

export interface AblationOptions {
  /** Largest allowed (max - min) / median between the rounds of one arm. Default 0.15. */
  readonly maxSpread?: number;
  /** Statistic taken from each round. Default `median`. */
  readonly statistic?: AblationStatistic;
}

export interface AblationArmResult {
  /** The chosen statistic of each round of this arm, in run order. NaN for a round without finite samples. */
  readonly rounds: readonly number[];
  /** Median of `rounds`: the arm's value in the comparison. */
  readonly value: number;
  /** (max - min) / value over `rounds`; 0 when all rounds agree, Infinity when value is 0 but rounds differ. */
  readonly spread: number;
  /** Half of max - min over `rounds`: how far this arm wandered from round to round. */
  readonly halfRange: number;
}

export interface AblationResult {
  readonly statistic: AblationStatistic;
  readonly maxSpread: number;
  readonly a: AblationArmResult;
  readonly b: AblationArmResult;
  /** B.value - A.value. Negative is faster. NaN when invalid. */
  readonly difference: number;
  /** difference / A.value. NaN when invalid or A.value is 0. */
  readonly relative: number;
  /** sqrt(a.halfRange^2 + b.halfRange^2). A difference smaller than this is indistinguishable from drift. */
  readonly noiseBand: number;
  readonly verdict: AblationVerdict;
  /** Why the result is `rejected` or `invalid`; empty otherwise. */
  readonly reasons: readonly string[];
}

const DEFAULT_MAX_SPREAD = 0.15;
const MIN_ROUNDS_PER_ARM = 2;

function median(values: readonly number[]): number {
  return summarizeTestSamples(values)?.median ?? Number.NaN;
}

function armResult(rounds: readonly number[]): AblationArmResult {
  const value = median(rounds);
  const finite = rounds.filter(Number.isFinite);
  if (!finite.length) return { rounds, value, spread: Number.NaN, halfRange: Number.NaN };
  const range = Math.max(...finite) - Math.min(...finite);
  const spread = range === 0 ? 0 : value === 0 ? Number.POSITIVE_INFINITY : range / Math.abs(value);
  return { rounds, value, spread, halfRange: range / 2 };
}

/**
 * Compares a feature (B) against its baseline (A) from alternating rounds (A B A B ...).
 *
 * Alternating cancels slow drift (thermals, clocks, background load) that would otherwise look like an
 * effect. Each round is reduced to one number (`statistic`), so one slow round cannot hide in a pooled
 * sample. An arm's value is the median of its round numbers.
 *
 * Two guards keep a noisy machine from producing a verdict:
 * - Spread: (max - min) / median of an arm's round numbers above `maxSpread` (default 15 %) rejects the run.
 * - Noise band: the half range (half of max - min) of each arm's round numbers, combined as
 *   sqrt(halfRangeA^2 + halfRangeB^2). B is `faster` or `slower` only when |difference| is larger than it;
 *   otherwise the verdict is `no-difference`.
 *
 * Lower is better (the metric is a time). Needs at least two rounds per arm; a smaller experiment has no
 * way to measure its own noise. Never throws: unusable input gives verdict `invalid` and `reasons`.
 */
export function compareAblation(rounds: readonly AblationRound[], options: AblationOptions = {}): AblationResult {
  const maxSpread = options.maxSpread ?? DEFAULT_MAX_SPREAD;
  const statistic = options.statistic ?? 'median';
  const reasons: string[] = [];
  if (!Number.isFinite(maxSpread) || maxSpread < 0) reasons.push(`maxSpread must be a finite number >= 0, got ${maxSpread}`);
  if (statistic !== 'median' && statistic !== 'p95') reasons.push(`Unknown statistic: ${String(statistic)}`);

  const perArm: Record<AblationArm, number[]> = { A: [], B: [] };
  rounds.forEach((round, index) => {
    if (round.arm !== 'A' && round.arm !== 'B') { reasons.push(`Round ${index + 1} has unknown arm ${String(round.arm)}`); return; }
    if (index > 0 && rounds[index - 1].arm === round.arm) reasons.push(`Rounds ${index} and ${index + 1} are both arm ${round.arm}: rounds must alternate`);
    const summary = summarizeTestSamples(round.samples);
    if (!summary) { reasons.push(`Round ${index + 1} (arm ${round.arm}) has no finite samples`); perArm[round.arm].push(Number.NaN); return; }
    if (summary.count !== round.samples.length) reasons.push(`Round ${index + 1} (arm ${round.arm}) has non-finite samples`);
    perArm[round.arm].push(statistic === 'p95' ? summary.p95 : summary.median);
  });
  for (const arm of ['A', 'B'] as const) {
    if (perArm[arm].length < MIN_ROUNDS_PER_ARM) {
      reasons.push(`Arm ${arm} has ${perArm[arm].length} round(s); at least ${MIN_ROUNDS_PER_ARM} are needed to measure noise`);
    }
  }

  const a = armResult(perArm.A);
  const b = armResult(perArm.B);
  if (reasons.length) {
    return { statistic, maxSpread, a, b, difference: Number.NaN, relative: Number.NaN, noiseBand: Number.NaN, verdict: 'invalid', reasons };
  }

  const difference = b.value - a.value;
  const relative = a.value === 0 ? Number.NaN : difference / a.value;
  const noiseBand = Math.hypot(a.halfRange, b.halfRange);
  for (const [name, arm] of [['A', a], ['B', b]] as const) {
    if (arm.spread > maxSpread) {
      reasons.push(`Arm ${name} spread ${(arm.spread * 100).toFixed(1)} % exceeds ${(maxSpread * 100).toFixed(1)} %`);
    }
  }
  const verdict: AblationVerdict = reasons.length ? 'rejected'
    : Math.abs(difference) <= noiseBand ? 'no-difference' : difference < 0 ? 'faster' : 'slower';
  return { statistic, maxSpread, a, b, difference, relative, noiseBand, verdict, reasons };
}
