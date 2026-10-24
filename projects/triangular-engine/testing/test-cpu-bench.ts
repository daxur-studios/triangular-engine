import type { TestMetric, TestRunAdapter, TestScenario, TestSetting, TestSuite } from './test-contracts';
import { createSpanRecorder, type SpanRecorder } from './core/test-spans';
import { describeTimer } from './core/test-timer';
import {
  DEFAULT_MAX_CPU_SAMPLES, DEFAULT_MIN_CPU_SAMPLES, iqrOutliers, measureCpuCase, scalingExponent,
} from './core/test-cpu-measure';
import { summarizeTestSamples } from './test-stats';
import { modeWarmupIterations, modeWindowMs } from './test-window';

/** Settings of a CPU bench scenario: the problem size `n` handed to `setup` and `run`. */
export interface CpuBenchSettings {
  readonly count: number;
}

export interface CpuBenchDefinition<TFixture> {
  /** Builds the state for problem size `n` (not timed). May be async. */
  setup(n: number): TFixture | Promise<TFixture>;
  /** One iteration of the work. With `spans`, the recorder is passed to time sub-parts with `begin/end/time`. */
  run(fixture: TFixture, n: number, spans: SpanRecorder | undefined): void;
  teardown?(fixture: TFixture, n: number): void;
  /** Problem sizes; one scenario (`n-<count>`) each. */
  counts: readonly number[];
  /** Names of sub-spans to record per iteration (microseconds; see `createSpanRecorder`). */
  spans?: readonly string[];
  /** Untimed `run` calls before sampling (default 3). */
  warmupIterations?: number;
  /** Minimum length of one sample, ms (default 1): the batch size is calibrated to it. */
  batchTargetMs?: number;
  minSamples?: number;
  maxSamples?: number;
  /** Window of a standard run per count, ms (default 1000). Sampling goes on until `minSamples` too. */
  durationMs?: number;
  /** Window in quick mode (default 300). */
  quickMs?: number;
}

export interface CpuBench<TFixture> {
  readonly scenarios: readonly TestScenario<CpuBenchSettings>[];
  readonly adapter: TestRunAdapter<CpuBenchSettings, undefined>;
  /** A performance suite of `evidence: 'cpu'` over the scenarios; `extra` may set `baseline`, `requiresVisualReview`... */
  suite(meta: { id: string; version: number; title: string }, extra?: Partial<Omit<TestSuite<CpuBenchSettings>, 'id' | 'version' | 'title' | 'purpose' | 'evidence' | 'scenarios'>>): TestSuite<CpuBenchSettings>;
  readonly definition: CpuBenchDefinition<TFixture>;
}

const OUTLIER_NOTICE = 0.1;

/**
 * A CPU micro-benchmark as a runnable suite: no scene, no ready gate, no thumbnail, not paced by vsync. Per count `n`
 * it calibrates a batch size so a sample lasts at least `batchTargetMs`, takes samples until `minSamples` and the
 * window are met, and yields to the event loop between samples so Cancel and progress work. Metrics per case:
 * `timeUs` (µs per iteration), `usPerUnit` (`timeUs / n`: flat across counts means linear scaling), and with `spans`
 * one metric each plus `unattributed` and `total`, grouped for the breakdown table. Raw samples are kept; IQR outliers
 * are counted in `details` (`outliers`) and flagged in the limitations when over 10 %. `details.scalingExponent` on the
 * later counts is the log-log slope of the median against `n` so far (1 linear, 2 quadratic).
 *
 * The suite is `evidence: 'cpu'`: it is never valid GPU evidence, and runs fine headless. Numbers are for the
 * browser/engine that ran them; compare only runs on the same machine and engine.
 */
export function cpuBench<TFixture>(definition: CpuBenchDefinition<TFixture>): CpuBench<TFixture> {
  if (!definition.counts.length || definition.counts.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error('cpuBench needs at least one positive count');
  }
  const durationMs = definition.durationMs ?? 1000;
  const scenarios: TestScenario<CpuBenchSettings>[] = definition.counts.map((count) => ({
    id: `n-${count}`, label: `n = ${count}`, settings: { count }, durationMs,
    quickMs: Math.min(durationMs, definition.quickMs ?? 300), warmupIterations: definition.warmupIterations ?? 3,
  }));
  let fixture: TFixture | undefined;
  let hasFixture = false;
  let fixtureCount = 0;
  const medians: { n: number; value: number }[] = [];
  const dispose = () => {
    if (hasFixture) { const old = fixture as TFixture; hasFixture = false; fixture = undefined; definition.teardown?.(old, fixtureCount); }
  };
  const adapter: TestRunAdapter<CpuBenchSettings, undefined> = {
    cpuOnly: true,
    windowModes: true,
    capture: () => undefined,
    apply: async (scenario) => {
      dispose();
      if (scenario.id === scenarios[0].id) medians.length = 0;
      fixture = await definition.setup(scenario.settings.count);
      hasFixture = true;
      fixtureCount = scenario.settings.count;
    },
    ready: async () => undefined,
    measure: async (scenario, context) => {
      const n = scenario.settings.count;
      const spans = definition.spans?.length ? createSpanRecorder(definition.spans, { unit: 'µs' }) : undefined;
      const current = fixture as TFixture;
      const soak = context.mode === 'soak';
      const result = await measureCpuCase({
        body: () => definition.run(current, n, spans),
        warmupIterations: modeWarmupIterations(scenario, context.mode),
        batchTargetMs: definition.batchTargetMs,
        minSamples: definition.minSamples ?? DEFAULT_MIN_CPU_SAMPLES,
        maxSamples: soak ? Number.MAX_SAFE_INTEGER : definition.maxSamples ?? DEFAULT_MAX_CPU_SAMPLES,
        windowMs: modeWindowMs(scenario, context.mode),
        signal: context.signal,
        round: spans ? { begin: () => spans.beginRound(), end: (iterations) => spans.endRound(iterations) } : undefined,
      });
      const micros = result.samples.map((ms) => ms * 1000);
      const source = `performance.now over batches of ${result.batch} (${result.iterations} iterations), per iteration`;
      const metrics: TestMetric[] = [
        { name: 'timeUs', unit: 'µs', source, samples: micros },
        { name: 'usPerUnit', unit: 'µs/unit', source: `${source}, divided by n`, samples: micros.map((v) => v / n) },
        ...(spans?.metrics().map((item) => ({ ...item, source: `${item.source}; batch ${result.batch}` })) ?? []),
      ];
      const fences = iqrOutliers(micros);
      const summary = summarizeTestSamples(micros);
      if (summary) medians.push({ n, value: summary.median });
      const exponent = scalingExponent(medians);
      const share = micros.length ? fences.indices.length / micros.length : 0;
      const timer = describeTimer(3);
      const details: Record<string, TestSetting> = {
        count: n, batch: result.batch, samples: micros.length, outliers: fences.indices.length,
        outlierFences: `${fences.low.toFixed(3)}..${fences.high.toFixed(3)} µs`,
        'timer.resolutionUs': Math.round(timer.resolutionMs * 1000),
        ...(exponent === null ? {} : { scalingExponent: Math.round(exponent * 100) / 100 }),
      };
      const limitations: string[] = [];
      if (share > OUTLIER_NOTICE) {
        limitations.push(`${fences.indices.length} of ${micros.length} samples (${Math.round(share * 100)} %) are IQR outliers; raw samples are kept, so the median is the number to read`);
      }
      if (result.samples.length && result.batch * (summary?.median ?? 0) / 1000 < timer.resolutionMs * 5) {
        limitations.push('A sample lasts under five timer steps; the clock is too coarse for this work, so use a larger batch target');
      }
      return { metrics, limitations, details };
    },
    restore: () => dispose(),
    environment: () => {
      const timer = describeTimer();
      return { evidence: 'cpu-only', 'timer.source': timer.source, 'timer.resolutionUs': Math.round(timer.resolutionMs * 1000) };
    },
  };
  return {
    scenarios, adapter, definition,
    suite: (meta, extra = {}) => ({ ...meta, ...extra, purpose: 'performance', evidence: 'cpu', scenarios }),
  };
}
