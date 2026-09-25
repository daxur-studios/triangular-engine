import { expect, test } from '@playwright/test';
import { coefficientOfVariation, countHitches, median, percentile, round, summarize } from '../lib/perf-stats';

test.describe('perf-stats', () => {
  test('percentile interpolates linearly between ranks', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 50)).toBe(2.5);
    expect(percentile(sorted, 100)).toBe(4);
    expect(percentile(sorted, 25)).toBeCloseTo(1.75);
    expect(percentile([], 50)).toBeNaN();
  });

  test('summarize reports order statistics and ignores non-finite samples', () => {
    const samples = [5, 1, 4, 2, 3, Number.NaN, Number.POSITIVE_INFINITY];
    const summary = summarize(samples)!;
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(5);
    expect(summary.mean).toBe(3);
    expect(summary.p50).toBe(3);
    expect(summary.stddev).toBeCloseTo(Math.sqrt(2));
    expect(summary.p95).toBeCloseTo(4.8);
  });

  test('summarize returns null rather than zeros for empty input', () => {
    expect(summarize([])).toBeNull();
    expect(summarize([Number.NaN])).toBeNull();
  });

  test('median does not mutate its input', () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
  });

  test('countHitches counts intervals strictly above each threshold', () => {
    expect(countHitches([16.7, 33.4, 34, 51, 120])).toEqual({ 'over33.4ms': 3, over50ms: 2, over100ms: 1 });
    expect(countHitches([10, 20], [15])).toEqual({ over15ms: 1 });
  });

  test('coefficientOfVariation is zero for stable or single values', () => {
    expect(coefficientOfVariation([2])).toBe(0);
    expect(coefficientOfVariation([2, 2, 2])).toBe(0);
    expect(coefficientOfVariation([1, 3])).toBeCloseTo(0.5);
  });

  test('round keeps a fixed number of decimals', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(round(1.23456, 1)).toBe(1.2);
  });
});
