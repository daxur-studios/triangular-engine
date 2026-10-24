import { describeTimer, nowMs } from './test-timer';
import type { CpuMetric } from './test-helpers';

export interface SpanRecorderOptions {
  /** Rounds stored before the buffers double (default 1024). Doubling allocates inside `endRound`, never in a span. */
  readonly capacity?: number;
  /** Unit of the metrics: `ms` (default) or `µs`. Samples are always recorded in ms. */
  readonly unit?: 'ms' | 'µs';
  /** `TestMetric.group` of the metrics (default `spans`). */
  readonly group?: string;
  /** Skip the start-up calibration and use these costs, for tests or a known timer. */
  readonly timerCost?: SpanTimerCost;
}

/** Cost of the recorder's own calls, measured at creation with empty spans. */
export interface SpanTimerCost {
  /** Time one empty begin..end pair adds INSIDE a span; subtracted from every span. */
  readonly spanMs: number;
  /** Time one begin + end pair adds to a round overall; subtracted from the round total. */
  readonly pairMs: number;
}

export interface SpanRecorder<N extends string = string> {
  readonly names: readonly N[];
  readonly timerCost: SpanTimerCost;
  /** Rounds finished so far. */
  readonly rounds: number;
  /** Starts a round (one iteration, or one batch of iterations). */
  beginRound(): void;
  /**
   * Closes the round and stores one sample per span plus the total. `iterations` divides every stored value, so a batch
   * of `n` runs inside one round gives per-iteration samples. The timer cost of the round's calls is removed.
   */
  endRound(iterations?: number): void;
  /** Starts timing a span in the open round; spans may repeat in a round (their time adds up) but must not nest in themselves. */
  begin(name: N): void;
  end(name: N): void;
  /** `begin`, run `fn`, `end` (also when it throws), and return its result. */
  time<T>(name: N, fn: () => T): T;
  /**
   * One metric per span, then `unattributed` (round total minus the spans, so work outside any span shows up) and
   * `total`. Each has `group` and `share`: its fraction of all rounds' total time (total is 1).
   */
  metrics(source?: string): CpuMetric[];
  /** Forgets all rounds. */
  reset(): void;
}

const RESERVED = ['total', 'unattributed'];

/**
 * Preallocated named sub-span timing for a repeated computation. Per round: `beginRound()`, any number of
 * `begin/end/time`, `endRound()`. The recorder measures the cost of its own calls at creation (empty spans) and removes
 * it, so cheap spans are not inflated by the timer. Spans share `performance.now()`, so a span near the timer
 * resolution (see `describeTimer`) is noise; time a batch round (`endRound(n)`) instead.
 */
export function createSpanRecorder<const N extends string>(names: readonly N[], options: SpanRecorderOptions = {}): SpanRecorder<N> {
  if (!names.length) throw new Error('createSpanRecorder needs at least one span name');
  if (new Set(names).size !== names.length) throw new Error('Span names must be unique');
  for (const name of names) if (RESERVED.includes(name)) throw new Error(`"${name}" is a reserved span name`);
  const count = names.length;
  const index = new Map<string, number>(names.map((name, i) => [name, i]));
  const unit = options.unit ?? 'ms';
  const scale = unit === 'µs' ? 1000 : 1;
  let capacity = Math.max(1, options.capacity ?? 1024);
  let spans = names.map(() => new Float64Array(capacity));
  let totals = new Float64Array(capacity);
  let unattributed = new Float64Array(capacity);
  const started = new Float64Array(count);
  const accumulated = new Float64Array(count);
  const calls = new Int32Array(count);
  let roundStart = 0;
  let rounds = 0;
  let cost: SpanTimerCost = options.timerCost ?? { spanMs: 0, pairMs: 0 };
  const lookup = (name: string): number => {
    const id = index.get(name);
    if (id === undefined) throw new Error(`Unknown span "${name}"`);
    return id;
  };

  const recorder: SpanRecorder<N> = {
    names,
    get timerCost() { return cost; },
    get rounds() { return rounds; },
    beginRound() {
      accumulated.fill(0);
      calls.fill(0);
      roundStart = nowMs();
    },
    endRound(iterations = 1) {
      const total = nowMs() - roundStart;
      if (rounds === capacity) {
        capacity *= 2;
        const grow = (old: Float64Array) => { const next = new Float64Array(capacity); next.set(old); return next; };
        spans = spans.map(grow);
        totals = grow(totals);
        unattributed = grow(unattributed);
      }
      let pairs = 0;
      let attributed = 0;
      for (let i = 0; i < count; i++) {
        pairs += calls[i];
        const corrected = Math.max(0, accumulated[i] - cost.spanMs * calls[i]) / iterations;
        spans[i][rounds] = corrected;
        attributed += corrected;
      }
      const totalCorrected = Math.max(0, total - cost.pairMs * pairs) / iterations;
      totals[rounds] = totalCorrected;
      unattributed[rounds] = Math.max(0, totalCorrected - attributed);
      rounds++;
    },
    begin(name) { started[lookup(name)] = nowMs(); },
    end(name) {
      const t = nowMs();
      const id = lookup(name);
      accumulated[id] += t - started[id];
      calls[id]++;
    },
    time(name, fn) {
      recorder.begin(name);
      try { return fn(); } finally { recorder.end(name); }
    },
    metrics(source) {
      const group = options.group ?? 'spans';
      const resolution = describeTimer(3).resolutionMs;
      const text = source ?? `span recorder over performance.now (step ${(resolution * 1000).toFixed(0)} µs, ` +
        `${(cost.spanMs * 1e6).toFixed(0)} ns/span removed); ${rounds} rounds`;
      const sum = (values: Float64Array) => { let s = 0; for (let i = 0; i < rounds; i++) s += values[i]; return s; };
      const totalSum = sum(totals);
      const make = (name: string, values: Float64Array): CpuMetric => ({
        name, unit, source: text, group, share: totalSum > 0 ? sum(values) / totalSum : 0,
        samples: Array.from(values.subarray(0, rounds), (v) => v * scale),
      });
      return [...names.map((name, i) => make(name, spans[i])), make('unattributed', unattributed), make('total', totals)];
    },
    reset() { rounds = 0; accumulated.fill(0); calls.fill(0); },
  };

  if (!options.timerCost) {
    // Empty spans measure the recorder's own cost. Take the smallest of a few runs: noise only adds.
    const first = names[0];
    let spanMs = Number.POSITIVE_INFINITY;
    let pairMs = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run++) {
      recorder.beginRound();
      for (let i = 0; i < 2000; i++) { recorder.begin(first); recorder.end(first); }
      const overall = nowMs() - roundStart;
      spanMs = Math.min(spanMs, accumulated[0] / 2000);
      pairMs = Math.min(pairMs, overall / 2000);
    }
    cost = { spanMs, pairMs: Math.max(pairMs, spanMs) };
  }
  recorder.reset();
  return recorder;
}
