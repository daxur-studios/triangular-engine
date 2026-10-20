import type { AblationArm, AblationResult, AblationStatistic } from './test-ablation';

/** JSON-compatible setting values keep launch inputs and results portable between applications. */
export type TestSetting = string | number | boolean | null;

/** A page owns the meaning of its settings and implements them through its normal application actions. */
export interface TestScenario<TSettings extends object> {
  readonly id: string;
  readonly label: string;
  readonly settings: TSettings;
  readonly durationMs: number;
  readonly warmupMs?: number;
  /** One round of an A/B comparison (`TestSuite.ablation`): rounds of a group must alternate A, B, A, B. */
  readonly ablation?: { readonly group: string; readonly arm: AblationArm };
}

/**
 * An A/B feature comparison inside a suite. `TestSession` runs `compareAblation` per scenario group and per metric
 * over the rounds in run order, and stores the outcomes in `TestRunResult.ablations`.
 */
export interface TestAblationSpec {
  /** What B turns on, for the report. */
  readonly feature: string;
  /** Metric names to compare (lower is better). */
  readonly metrics: readonly string[];
  readonly statistic?: AblationStatistic;
  readonly maxSpread?: number;
}

export interface TestAblationOutcome {
  readonly group: string;
  readonly feature: string;
  readonly metric: string;
  readonly result: AblationResult;
  /** Rounds of this group with a validity issue; their numbers are in `result` but are not hardware evidence. */
  readonly invalidRounds: number;
}

/** Append suites oldest-first; never edit an already shared ID/version to mean a different experiment. */
export interface TestSuite<TSettings extends object> {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly purpose: 'functional' | 'performance';
  readonly requiresVisualReview?: boolean;
  /**
   * Performance suites only: the GPU vendor the numbers are meant for (matched case-insensitively against the recorded
   * `gpu.vendor`, for example `nvidia`). A case on another vendor, or with no recorded adapter, is invalid evidence.
   */
  readonly expectedGpuVendor?: string;
  readonly ablation?: TestAblationSpec;
  readonly scenarios: readonly TestScenario<TSettings>[];
}

export type TestProfile = 'visible-browser' | 'human-observed' | 'headless-hardware';
/**
 * How long each measurement window runs (`TestContext.measureWindow`):
 * - `quick`: stops once every watched series has settled (at least `QUICK_MIN_WINDOW_MS` and `QUICK_MIN_SAMPLES`),
 *   at most the scenario's `durationMs`; warmup is cut to at most `QUICK_WARMUP_MS`. For checking work as you go.
 * - `standard`: the scenario's `durationMs`. For results that count (baselines, final comparisons).
 * - `soak`: at least `SOAK_WINDOW_MS`, and reports how far each series drifted from the first to the last quarter.
 */
export type TestMode = 'quick' | 'standard' | 'soak';
export type TestPhase = 'preparing' | 'applying' | 'ready' | 'warmup' | 'measuring' | 'paused' | 'restoring';

/** Progress changes at lifecycle boundaries, avoiding per-frame Angular UI work during measurement. */
export interface TestProgress {
  readonly phase: TestPhase;
  readonly scenarioId?: string;
  readonly label?: string;
  readonly completed: number;
  readonly total: number;
  readonly repetition: number;
  /** Set while a scenario is redone after the page was hidden or lost focus (1 = first redo). */
  readonly retry?: number;
  /** Why the run is paused (`phase: 'paused'`). */
  readonly pausedReason?: string;
}

/** A metric reports the provider's actual sample source, not an inferred GPU-pass attribution. */
export interface TestMetric {
  readonly name: string;
  readonly unit: string;
  readonly source: string;
  readonly samples: readonly number[];
  readonly unavailableReason?: string;
  /**
   * A reading this page cannot provide (for example GPU time without a timestamp query). List it with an
   * `unavailableReason` so the gap is visible; it does not make a performance case inconclusive.
   * Invalid (non-finite) samples still do.
   */
  readonly optional?: boolean;
  /** Filled by `TestSession` from `samples` (nearest-rank percentiles); absent when there are no finite samples. */
  readonly summary?: TestMetricSummary;
}

/** Nearest-rank statistics of one metric's samples, so readers need not load the raw samples. */
export interface TestMetricSummary {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export interface TestCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface TestObservation {
  readonly metrics: readonly TestMetric[];
  readonly checks?: readonly TestCheck[];
  readonly limitations?: readonly string[];
  readonly validityIssues?: readonly string[];
  readonly details?: Readonly<Record<string, TestSetting>>;
}

/** A live sample series a measurement window watches to decide when it has settled. */
export interface TestSettleSeries {
  readonly name: string;
  /** The window's samples so far; read, never changed. */
  readonly samples: () => readonly number[];
  /** The series' step (timer resolution) in its unit: a change smaller than this never counts as unsettled. */
  readonly resolution?: number;
}

/** How a measurement window ran; `TestSession` records it on the case. */
export interface TestWindow {
  readonly mode: TestMode;
  readonly elapsedMs: number;
  /** `settled`: quick mode saw stable series; `max`: it ran to `durationMs`; `fixed`: the mode's length, no watching. */
  readonly stoppedBy: 'settled' | 'max' | 'fixed';
  /** Samples per watched series when the window ended. */
  readonly samples?: Readonly<Record<string, number>>;
  /** Soak only: relative change of each series' median from its first to its last quarter (0.05 = 5% higher). */
  readonly drift?: Readonly<Record<string, number>>;
}

/** Adapters must cooperate with abort, and resolve actions only when the requested state is rendered. */
export interface TestContext {
  readonly signal: AbortSignal;
  readonly profile: TestProfile;
  readonly mode: TestMode;
  readonly repetition: number;
  wait(milliseconds: number): Promise<void>;
  /**
   * The measurement window for `scenario` in this run's mode; call it from `measure` in place of
   * `wait(scenario.durationMs)`. Quick mode watches `series` and stops once they settle; without series it runs a
   * fixed `QUICK_WINDOW_MS` (at most `durationMs`). Rejects on abort, like `wait`.
   */
  measureWindow(scenario: TestScenario<object>, series?: readonly TestSettleSeries[]): Promise<TestWindow>;
}

/** Capture is read-only. Restore must be safe after a partially applied scenario, including errors/cancel. */
export interface TestRunAdapter<TSettings extends object, TSnapshot = unknown> {
  capture(context: TestContext): TSnapshot | Promise<TSnapshot>;
  apply(scenario: TestScenario<TSettings>, context: TestContext): void | Promise<void>;
  /** `scenario` is the one just applied, so the adapter need not remember it. */
  ready(context: TestContext, scenario: TestScenario<TSettings>): Promise<void>;
  measure(scenario: TestScenario<TSettings>, context: TestContext): Promise<TestObservation>;
  restore(snapshot: TSnapshot, context: TestContext): void | Promise<void>;
  environment?(): Readonly<Record<string, TestSetting>>;
  /**
   * The adapter times its measurement with `context.measureWindow`, so quick and soak modes change its windows.
   * Without it the runner offers only `standard`: scenario timings that drive an animation (a sweep, a fly-by) must
   * keep their length.
   */
  readonly windowModes?: boolean;
}

export interface TestCaseResult<TSettings extends object> {
  readonly scenario: TestScenario<TSettings>;
  readonly repetition: number;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly metrics: readonly TestMetric[];
  readonly checks: readonly TestCheck[];
  readonly validityIssues: readonly string[];
  readonly limitations: readonly string[];
  readonly details?: Readonly<Record<string, TestSetting>>;
  readonly error?: string;
  /** The last measurement window of this case, when the adapter used `measureWindow`. */
  readonly window?: TestWindow;
  /** Times this case was redone because the page was hidden or lost focus. */
  readonly retries?: number;
}

/** Completed automation, usable performance evidence and human acceptance are separate outcomes. */
export interface TestRunResult<TSettings extends object> {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly suite: TestSuite<TSettings>;
  readonly profile: TestProfile;
  /** Absent in results saved before modes existed, which ran as `standard`. */
  readonly mode?: TestMode;
  readonly repetitions: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: 'completed' | 'failed' | 'cancelled' | 'inconclusive';
  readonly automatedVerdict: 'pass' | 'fail' | 'not-run';
  readonly performanceVerdict: 'unassessed' | 'inconclusive' | 'not-run';
  readonly visualReview: 'not-required' | 'pending' | 'accepted' | 'rejected';
  readonly reviewNotes?: string;
  readonly environment: Readonly<Record<string, TestSetting>>;
  readonly cases: readonly TestCaseResult<TSettings>[];
  /** Suites with `ablation`: one outcome per group and metric. */
  readonly ablations?: readonly TestAblationOutcome[];
  readonly errors: readonly string[];
  readonly rerunUrl?: string;
}

export interface TestRunOptions {
  readonly repetitions: number;
  readonly profile: TestProfile;
  /** Default `standard`. `quick` and `soak` need an adapter with `windowModes`. */
  readonly mode?: TestMode;
  readonly timeoutMs?: number;
  /**
   * Result-sink URL of a local receiver. When set, a performance run tells the receiver when each measure step starts
   * and stops (`POST <url>/machine/{prepare,start,stop}`) so it can record what the machine was doing. Fire-and-forget:
   * it never blocks or fails a run. `<tri-test-runner>` sets it from `resultSink` in dev builds.
   */
  readonly machineSink?: string;
}
