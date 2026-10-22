import type { TestMode, TestScenario, TestSettleSeries, TestWindow } from './test-contracts';
import { nearestRankPercentile } from './test-stats';

/** Quick mode never stops before this, so a burst of identical early frames cannot end a window. */
export const QUICK_MIN_WINDOW_MS = 1000;
/** Quick mode needs this many samples in every watched series before it may stop. */
export const QUICK_MIN_SAMPLES = 60;
/** Quick-mode window for an adapter that watches no series. */
export const QUICK_WINDOW_MS = 2000;
/** Quick mode cuts each scenario's warmup to at most this. */
export const QUICK_WARMUP_MS = 500;
/** Soak windows run at least this long. */
export const SOAK_WINDOW_MS = 60_000;
/** Settled: the two halves of the window agree on the median within 5% and on the p95 within 10%. */
export const SETTLE_MEDIAN_TOLERANCE = 0.05;
export const SETTLE_P95_TOLERANCE = 0.1;
const POLL_MS = 100;

/** The warmup a scenario gets in `mode`. */
export function modeWarmupMs(scenario: Pick<TestScenario<object>, 'warmupMs'>, mode: TestMode): number {
  const warmup = scenario.warmupMs ?? 0;
  return mode === 'quick' ? Math.min(warmup, QUICK_WARMUP_MS) : warmup;
}

/** The longest window a scenario gets in `mode`. */
export function modeWindowMs(scenario: Pick<TestScenario<object>, 'durationMs' | 'quickMs'>, mode: TestMode): number {
  if (mode === 'quick') return scenario.quickMs ?? scenario.durationMs;
  return mode === 'soak' ? Math.max(scenario.durationMs, SOAK_WINDOW_MS) : scenario.durationMs;
}

/**
 * How long a timed action (a sweep, a fly-by: motion whose speed follows its length) runs in `mode`: the scenario's
 * `quickMs` in quick mode when it has one, otherwise `durationMs`. Soak does not stretch an action.
 */
export function modeActionMs(scenario: Pick<TestScenario<object>, 'durationMs' | 'quickMs'>, mode: TestMode): number {
  return mode === 'quick' ? scenario.quickMs ?? scenario.durationMs : scenario.durationMs;
}

function stats(samples: readonly number[]): { median: number; p95: number } {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  return { median: nearestRankPercentile(sorted, 0.5), p95: nearestRankPercentile(sorted, 0.95) };
}

// The 1e-9 slack keeps one timer step (0.4 - 0.3 is 0.10000000000000003) inside its own resolution.
const agrees = (a: number, b: number, whole: number, tolerance: number, resolution: number) =>
  Math.abs(a - b) <= Math.max(Math.abs(whole) * tolerance, resolution) + 1e-9;

/**
 * True when the first and second halves of the series agree on median and p95, within the settle tolerances or the
 * series' resolution, and the series has at least `minSamples` finite samples.
 */
export function seriesSettled(samples: readonly number[], resolution = 0, minSamples = QUICK_MIN_SAMPLES): boolean {
  const finite = samples.filter(Number.isFinite);
  if (finite.length < minSamples) return false;
  const half = Math.floor(finite.length / 2);
  const first = stats(finite.slice(0, half));
  const second = stats(finite.slice(half));
  const whole = stats(finite);
  return agrees(first.median, second.median, whole.median, SETTLE_MEDIAN_TOLERANCE, resolution)
    && agrees(first.p95, second.p95, whole.p95, SETTLE_P95_TOLERANCE, resolution);
}

/** Relative change of the median from the first to the last quarter; `null` below 8 samples or a zero first median. */
export function seriesDrift(samples: readonly number[]): number | null {
  const finite = samples.filter(Number.isFinite);
  if (finite.length < 8) return null;
  const quarter = Math.floor(finite.length / 4);
  const first = stats(finite.slice(0, quarter)).median;
  const last = stats(finite.slice(-quarter)).median;
  return first === 0 ? null : (last - first) / Math.abs(first);
}

function counts(series: readonly TestSettleSeries[]): Record<string, number> {
  return Object.fromEntries(series.map((item) => [item.name, item.samples().filter(Number.isFinite).length]));
}

/**
 * Runs one measurement window in `mode`. `wait` must reject on abort; `now` is injectable for tests.
 */
export async function runMeasureWindow(
  scenario: Pick<TestScenario<object>, 'durationMs' | 'quickMs'>, mode: TestMode, series: readonly TestSettleSeries[],
  wait: (ms: number) => Promise<void>, now: () => number = () => performance.now(),
): Promise<TestWindow> {
  const began = now();
  const elapsed = () => now() - began;
  if (mode !== 'quick') {
    await wait(modeWindowMs(scenario, mode));
    const drift: Record<string, number> = {};
    if (mode === 'soak') for (const item of series) { const d = seriesDrift(item.samples()); if (d !== null) drift[item.name] = d; }
    return { mode, elapsedMs: elapsed(), stoppedBy: 'fixed', samples: series.length ? counts(series) : undefined,
      drift: mode === 'soak' ? drift : undefined };
  }
  if (!series.length) {
    await wait(Math.min(scenario.durationMs, scenario.quickMs ?? QUICK_WINDOW_MS));
    return { mode, elapsedMs: elapsed(), stoppedBy: 'fixed' };
  }
  const maxMs = modeWindowMs(scenario, mode);
  while (elapsed() < maxMs) {
    if (elapsed() >= QUICK_MIN_WINDOW_MS && series.every((item) => seriesSettled(item.samples(), item.resolution))) {
      return { mode, elapsedMs: elapsed(), stoppedBy: 'settled', samples: counts(series) };
    }
    await wait(Math.min(POLL_MS, Math.max(1, maxMs - elapsed())));
  }
  return { mode, elapsedMs: elapsed(), stoppedBy: 'max', samples: counts(series) };
}
