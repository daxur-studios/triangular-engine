import type { TestMetricSummary } from './test-contracts';

/**
 * Nearest-rank percentile on an ascending array: the value at rank ceil(p * n), as `FrameSampler` and the
 * `triangular-test-summary` bin use, so every reader reports the same p95.
 */
export function nearestRankPercentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

/** Statistics over the finite samples; `undefined` when there are none. */
export function summarizeTestSamples(samples: readonly number[]): TestMetricSummary | undefined {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  return {
    count: sorted.length, min: sorted[0], median: nearestRankPercentile(sorted, 0.5),
    p95: nearestRankPercentile(sorted, 0.95), max: sorted[sorted.length - 1],
  };
}
