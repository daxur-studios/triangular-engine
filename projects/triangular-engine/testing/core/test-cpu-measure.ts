import { describeTimer, nowMs } from './test-timer';

/** Quick mode cuts `warmupIterations` to at most this. */
export const QUICK_WARMUP_ITERATIONS = 5;
/** A sample (one batch) takes at least this long, so the timer's step is a small part of it. */
export const DEFAULT_BATCH_TARGET_MS = 1;
export const DEFAULT_MIN_CPU_SAMPLES = 30;
export const DEFAULT_MAX_CPU_SAMPLES = 1000;
const MAX_BATCH = 1_000_000;
/** Hand the thread back through a timer (not only a message) at least this often, so timers and aborts can run. */
const TIMER_YIELD_EVERY_MS = 50;

/** Lets the event loop run (messages, timers, input). Uses a `MessageChannel` where there is one: no 4 ms timer clamp. */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(0);
  });
}

export interface CpuMeasureOptions {
  /** One iteration of the work. Setup belongs outside it. */
  readonly body: () => void;
  readonly warmupIterations?: number;
  /** Each sample runs `body` in batches of the size found by calibration, so it lasts at least this long. Default 1 ms. */
  readonly batchTargetMs?: number;
  /** Sampling goes on until there are at least this many samples (default 30) ... */
  readonly minSamples?: number;
  /** ... and at least `windowMs` has passed, but never more than this many (default 1000). */
  readonly maxSamples?: number;
  readonly windowMs?: number;
  readonly signal?: AbortSignal;
  /** Brackets every timed batch, for example the `beginRound` and `endRound` of a span recorder. */
  readonly round?: { begin(): void; end(iterations: number): void };
}

export interface CpuMeasurement {
  /** Milliseconds per iteration, one value per batch, in run order. Never trimmed. */
  readonly samples: number[];
  /** Iterations per timed batch. */
  readonly batch: number;
  readonly iterations: number;
  readonly elapsedMs: number;
  readonly timerResolutionMs: number;
}

/**
 * Times `body` without any frame pacing: warm-up, a batch size that makes a sample last at least `batchTargetMs`
 * (raised to ten timer steps on a coarse clock), then batches until `minSamples` and `windowMs` are met. The thread
 * is yielded between samples (outside the timing), so a cancelled run stops and the page stays responsive.
 * Rejects with the signal's reason on abort.
 */
export async function measureCpuCase(options: CpuMeasureOptions): Promise<CpuMeasurement> {
  const { body, signal, round } = options;
  const minSamples = Math.max(1, options.minSamples ?? DEFAULT_MIN_CPU_SAMPLES);
  const maxSamples = Math.max(minSamples, options.maxSamples ?? DEFAULT_MAX_CPU_SAMPLES);
  const windowMs = options.windowMs ?? 0;
  const resolution = describeTimer().resolutionMs;
  const target = Math.max(options.batchTargetMs ?? DEFAULT_BATCH_TARGET_MS, resolution * 10);
  for (let i = 0; i < (options.warmupIterations ?? 0); i++) body();
  signal?.throwIfAborted();

  const timeBatch = (size: number): number => {
    const start = nowMs();
    for (let i = 0; i < size; i++) body();
    return nowMs() - start;
  };
  // Grow the batch geometrically (at most 10x a step) until one batch is long enough.
  let batch = 1;
  let spent = timeBatch(batch);
  while (spent < target && batch < MAX_BATCH) {
    const grow = spent > 0 ? Math.min(10, (target * 1.2) / spent) : 10;
    batch = Math.min(MAX_BATCH, Math.max(batch + 1, Math.ceil(batch * grow)));
    spent = timeBatch(batch);
  }

  const samples: number[] = [];
  const began = nowMs();
  let lastTimerYield = began;
  let iterations = 0;
  while (samples.length < minSamples || (nowMs() - began < windowMs && samples.length < maxSamples)) {
    round?.begin();
    const start = nowMs();
    for (let i = 0; i < batch; i++) body();
    const elapsed = nowMs() - start;
    round?.end(batch);
    samples.push(elapsed / batch);
    iterations += batch;
    if (nowMs() - lastTimerYield > TIMER_YIELD_EVERY_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastTimerYield = nowMs();
    } else await yieldToEventLoop();
    signal?.throwIfAborted();
  }
  return { samples, batch, iterations, elapsedMs: nowMs() - began, timerResolutionMs: resolution };
}

export interface IqrOutliers {
  readonly q1: number;
  readonly q3: number;
  readonly low: number;
  readonly high: number;
  /** Indices into the input, in order. */
  readonly indices: number[];
}

/** Tukey fences: values below `q1 - k*iqr` or above `q3 + k*iqr` (default k = 1.5). The input is not changed or trimmed. */
export function iqrOutliers(samples: readonly number[], k = 1.5): IqrOutliers {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (p: number): number => {
    if (!sorted.length) return Number.NaN;
    const at = (sorted.length - 1) * p;
    const lower = Math.floor(at);
    return sorted[lower] + (sorted[Math.min(sorted.length - 1, lower + 1)] - sorted[lower]) * (at - lower);
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const low = q1 - k * (q3 - q1);
  const high = q3 + k * (q3 - q1);
  const indices: number[] = [];
  samples.forEach((value, i) => { if (Number.isFinite(value) && (value < low || value > high)) indices.push(i); });
  return { q1, q3, low, high, indices };
}

/**
 * Least-squares slope of log(value) against log(n): 1 means cost grows linearly with n, 2 quadratically. `null` with
 * fewer than two points of distinct positive n and positive value.
 */
export function scalingExponent(points: readonly { readonly n: number; readonly value: number }[]): number | null {
  const usable = points.filter((p) => p.n > 0 && p.value > 0 && Number.isFinite(p.n) && Number.isFinite(p.value));
  if (new Set(usable.map((p) => p.n)).size < 2) return null;
  const xs = usable.map((p) => Math.log(p.n));
  const ys = usable.map((p) => Math.log(p.value));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return num / den;
}
