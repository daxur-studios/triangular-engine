/** JSON-compatible setting values keep launch inputs and results portable between applications. */
export type TestSetting = string | number | boolean | null;

/** A page owns the meaning of its settings and implements them through its normal application actions. */
export interface TestScenario<TSettings extends object> {
  readonly id: string;
  readonly label: string;
  readonly settings: TSettings;
  readonly durationMs: number;
  readonly warmupMs?: number;
}

/** Append suites oldest-first; never edit an already shared ID/version to mean a different experiment. */
export interface TestSuite<TSettings extends object> {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly purpose: 'functional' | 'performance';
  readonly requiresVisualReview?: boolean;
  readonly scenarios: readonly TestScenario<TSettings>[];
}

export type TestProfile = 'visible-browser' | 'human-observed' | 'headless-hardware';
export type TestPhase = 'preparing' | 'applying' | 'ready' | 'warmup' | 'measuring' | 'restoring';

/** Progress changes at lifecycle boundaries, avoiding per-frame Angular UI work during measurement. */
export interface TestProgress {
  readonly phase: TestPhase;
  readonly scenarioId?: string;
  readonly label?: string;
  readonly completed: number;
  readonly total: number;
  readonly repetition: number;
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

/** Adapters must cooperate with abort, and resolve actions only when the requested state is rendered. */
export interface TestContext {
  readonly signal: AbortSignal;
  readonly profile: TestProfile;
  readonly repetition: number;
  wait(milliseconds: number): Promise<void>;
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
}

/** Completed automation, usable performance evidence and human acceptance are separate outcomes. */
export interface TestRunResult<TSettings extends object> {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly suite: TestSuite<TSettings>;
  readonly profile: TestProfile;
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
  readonly errors: readonly string[];
  readonly rerunUrl?: string;
}

export interface TestRunOptions {
  readonly repetitions: number;
  readonly profile: TestProfile;
  readonly timeoutMs?: number;
}
