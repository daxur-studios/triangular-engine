/** Pure statistics helpers for perf samples. No Playwright or browser imports. */

export interface PerfDistribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Linear-interpolated percentile (the "type 7" definition used by numpy and
 * spreadsheets) over an ascending-sorted array. `p` is in [0, 100].
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

export function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

/** Returns `null` for an empty sample set so callers cannot mistake it for 0 ms. */
export function summarize(samples: readonly number[]): PerfDistribution | null {
  const finite = samples.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/** Default hitch thresholds: two missed 60 Hz frames, 20 fps, 10 fps. */
export const DEFAULT_HITCH_THRESHOLDS_MS = [33.4, 50, 100] as const;

/** Counts frame intervals strictly above each threshold. Keys are `over<threshold>ms`. */
export function countHitches(
  intervalsMs: readonly number[],
  thresholdsMs: readonly number[] = DEFAULT_HITCH_THRESHOLDS_MS,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const threshold of thresholdsMs) {
    result[`over${threshold}ms`] = intervalsMs.filter((value) => value > threshold).length;
  }
  return result;
}

/** Coefficient of variation (stddev / mean). `0` for fewer than two values. */
export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/** Rounds to a fixed number of decimals so history lines stay compact and diff-friendly. */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
