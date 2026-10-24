import type { TestMode, TestScenario, TestSettleSeries, TestWindow } from './test-contracts';
import { nearestRankPercentile } from './test-stats';
import { QUICK_WARMUP_ITERATIONS } from './core/test-cpu-measure';

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
// The values below are library-wide on purpose: one tolerance for every test, never tuned per test (plan 061).
/** Settled: block medians agree within 5% and block p95s within 10% (or one timer step). */
export const SETTLE_MEDIAN_TOLERANCE = 0.05;
export const SETTLE_P95_TOLERANCE = 0.1;
/** The series is cut into at least this many blocks (batch means), because consecutive frames are correlated. */
export const SETTLE_MIN_BLOCKS = 4;
const SETTLE_MAX_BLOCKS = 10;
/** Samples per block the block count aims for, so a block's p95 means something. */
const SETTLE_BLOCK_SAMPLES = 15;
/** Settled needs this many passing checks in a row. */
export const SETTLE_CONFIRMATIONS = 2;
/** A sample over this multiple of the median is a hitch (reported), and a leading one is warm-up (dropped). */
export const SPIKE_FACTOR = 2;
/** Leading warm-up samples dropped from a series, at most this many and at most a quarter of the series. */
export const WARMUP_DROP_MAX_SAMPLES = 60;
/** Hard cap of a steady window: ends a series that never settles as `capped` (inconclusive). Generous on purpose. */
export const TEST_CAP_MS = 60_000;
const POLL_MS = 100;
/** A series is checked again only once it has grown by this factor since its last check. */
const SETTLE_RECHECK_GROWTH = 1.1;

/** The warmup a scenario gets in `mode`. */
export function modeWarmupMs(scenario: Pick<TestScenario<object>, 'warmupMs'>, mode: TestMode): number {
  const warmup = scenario.warmupMs ?? 0;
  return mode === 'quick' ? Math.min(warmup, QUICK_WARMUP_MS) : warmup;
}

/** The untimed iterations a scenario gets in `mode` (`warmupIterations`, cut in quick mode). */
export function modeWarmupIterations(scenario: Pick<TestScenario<object>, 'warmupIterations'>, mode: TestMode): number {
  const iterations = scenario.warmupIterations ?? 0;
  return mode === 'quick' ? Math.min(iterations, QUICK_WARMUP_ITERATIONS) : iterations;
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

/** What one look at a series found. */
export interface SeriesAnalysis {
  readonly settled: boolean;
  /** Leading samples dropped as warm-up before the blocks were cut. */
  readonly warmupDropped: number;
  /** Samples over `SPIKE_FACTOR` times the median (after warm-up). */
  readonly hitches: number;
}

/**
 * Leading samples still over `SPIKE_FACTOR` times the median of the later half, up to `WARMUP_DROP_MAX_SAMPLES` and a
 * quarter of the series. Slow drift under that factor passes unseen.
 */
function leadingWarmup(finite: readonly number[]): number {
  const reference = stats(finite.slice(Math.floor(finite.length / 2))).median;
  if (!(reference > 0)) return 0;
  const limit = Math.min(WARMUP_DROP_MAX_SAMPLES, Math.floor(finite.length / 4));
  let dropped = 0;
  while (dropped < limit && finite[dropped] > SPIKE_FACTOR * reference) dropped++;
  return dropped;
}

/**
 * Block rule: drop warm-up, cut the rest into 4 to 10 blocks, and call the series settled when the block medians (and
 * the block p95s) all agree, within the settle tolerance of the whole or the series' resolution, and at least
 * `minSamples` finite samples remain. One passing check is a single look; `createSettleChecker` needs two in a row.
 */
export function analyzeSeries(samples: readonly number[], resolution = 0, minSamples = QUICK_MIN_SAMPLES): SeriesAnalysis {
  const finite = samples.filter(Number.isFinite);
  const warmupDropped = finite.length >= minSamples ? leadingWarmup(finite) : 0;
  const kept = finite.slice(warmupDropped);
  const whole = stats(kept);
  const hitches = whole.median > 0 ? kept.filter((value) => value > SPIKE_FACTOR * whole.median).length : 0;
  if (kept.length < minSamples) return { settled: false, warmupDropped, hitches };
  const blocks = Math.min(SETTLE_MAX_BLOCKS, Math.max(SETTLE_MIN_BLOCKS, Math.floor(kept.length / SETTLE_BLOCK_SAMPLES)));
  const medians: number[] = [];
  const p95s: number[] = [];
  for (let i = 0; i < blocks; i++) {
    const block = stats(kept.slice(Math.round(i * kept.length / blocks), Math.round((i + 1) * kept.length / blocks)));
    medians.push(block.median);
    p95s.push(block.p95);
  }
  const settled = agrees(Math.min(...medians), Math.max(...medians), whole.median, SETTLE_MEDIAN_TOLERANCE, resolution)
    && agrees(Math.min(...p95s), Math.max(...p95s), whole.p95, SETTLE_P95_TOLERANCE, resolution);
  return { settled, warmupDropped, hitches };
}

/** True when a single block-rule check of the series passes (see `analyzeSeries`). */
export function seriesSettled(samples: readonly number[], resolution = 0, minSamples = QUICK_MIN_SAMPLES): boolean {
  return analyzeSeries(samples, resolution, minSamples).settled;
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

/**
 * Settle check for growing series that costs little however long the window is: a series is re-evaluated (a copy and
 * sorts, see `analyzeSeries`) only after it has grown by 10 % since its last check, and the last answer stands in
 * between. A series counts as settled after `SETTLE_CONFIRMATIONS` passing evaluations in a row, so one lucky look
 * cannot end a window; a failing evaluation resets the streak.
 */
export function createSettleChecker(): {
  settled(item: Pick<TestSettleSeries, 'samples' | 'resolution'>, key?: string): boolean; readonly evaluations: number;
} {
  const last = new Map<string, { length: number; passes: number }>();
  let evaluations = 0;
  return {
    get evaluations() { return evaluations; },
    settled(item, key = '') {
      const samples = item.samples();
      const seen = last.get(key);
      if (samples.length < QUICK_MIN_SAMPLES) return false;
      if (seen && samples.length < seen.length * SETTLE_RECHECK_GROWTH) return seen.passes >= SETTLE_CONFIRMATIONS;
      evaluations++;
      const passes = analyzeSeries(samples, item.resolution).settled ? (seen?.passes ?? 0) + 1 : 0;
      last.set(key, { length: samples.length, passes });
      return passes >= SETTLE_CONFIRMATIONS;
    },
  };
}

/**
 * Polls `check` every `POLL_MS` until it passes `SETTLE_CONFIRMATIONS` times in a row (prelude settle condition).
 * Resolves false when `maxMs` passes first. `wait` must reject on abort; `now` is injectable for tests.
 */
export async function waitForSettled(
  check: () => boolean | Promise<boolean>, maxMs: number, wait: (ms: number) => Promise<void>, now: () => number = () => performance.now(),
): Promise<boolean> {
  const began = now();
  let passes = 0;
  while (true) {
    passes = (await check()) ? passes + 1 : 0;
    if (passes >= SETTLE_CONFIRMATIONS) return true;
    if (now() - began >= maxMs) return false;
    await wait(Math.min(POLL_MS, Math.max(1, maxMs - (now() - began))));
  }
}

function counts(series: readonly TestSettleSeries[]): Record<string, number> {
  return Object.fromEntries(series.map((item) => [item.name, item.samples().filter(Number.isFinite).length]));
}

/** Warm-up and hitch counts per series, as extra `TestWindow` fields (empty without series). */
function shape(series: readonly TestSettleSeries[]): Pick<TestWindow, 'warmupDropped' | 'hitches'> {
  if (!series.length) return {};
  const looks = series.map((item) => [item.name, analyzeSeries(item.samples(), item.resolution)] as const);
  return {
    warmupDropped: Object.fromEntries(looks.map(([name, look]) => [name, look.warmupDropped])),
    hitches: Object.fromEntries(looks.map(([name, look]) => [name, look.hitches])),
  };
}

/**
 * Runs one measurement window in `mode`. `wait` must reject on abort; `now` is injectable for tests.
 */
export async function runMeasureWindow(
  scenario: Pick<TestScenario<object>, 'durationMs' | 'quickMs' | 'phases'>, mode: TestMode, series: readonly TestSettleSeries[],
  wait: (ms: number) => Promise<void>, now: () => number = () => performance.now(),
): Promise<TestWindow> {
  const began = now();
  const elapsed = () => now() - began;
  const kind = scenario.phases?.window?.kind ?? 'steady';
  if (kind === 'counted') return { mode, elapsedMs: 0, stoppedBy: 'fixed', samples: series.length ? counts(series) : undefined };
  if (kind === 'scripted') {
    await wait(modeActionMs(scenario, mode));
    return { mode, elapsedMs: elapsed(), stoppedBy: 'fixed', samples: series.length ? counts(series) : undefined, ...shape(series) };
  }
  if (mode !== 'quick') {
    await wait(modeWindowMs(scenario, mode));
    const drift: Record<string, number> = {};
    if (mode === 'soak') for (const item of series) { const d = seriesDrift(item.samples()); if (d !== null) drift[item.name] = d; }
    return { mode, elapsedMs: elapsed(), stoppedBy: 'fixed', samples: series.length ? counts(series) : undefined,
      drift: mode === 'soak' ? drift : undefined, ...shape(series) };
  }
  if (!series.length) {
    await wait(Math.min(scenario.durationMs, scenario.quickMs ?? QUICK_WINDOW_MS));
    return { mode, elapsedMs: elapsed(), stoppedBy: 'fixed' };
  }
  const maxMs = Math.min(modeWindowMs(scenario, mode), scenario.phases?.window?.capMs ?? TEST_CAP_MS);
  const checker = createSettleChecker();
  while (elapsed() < maxMs) {
    // Every series is looked at each poll (no short-circuit), so each one's streak keeps building before the minimum.
    const settled = series.map((item) => checker.settled(item, item.name)).every(Boolean);
    if (elapsed() >= QUICK_MIN_WINDOW_MS && settled) {
      return { mode, elapsedMs: elapsed(), stoppedBy: 'settled', samples: counts(series), ...shape(series) };
    }
    await wait(Math.min(POLL_MS, Math.max(1, maxMs - elapsed())));
  }
  return { mode, elapsedMs: elapsed(), stoppedBy: 'capped', samples: counts(series), ...shape(series) };
}
