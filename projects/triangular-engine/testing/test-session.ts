import type {
  TestCaseResult, TestContext, TestMetric, TestMetricSummary, TestProgress, TestRunAdapter, TestRunOptions, TestRunResult,
  TestSetting, TestSuite,
} from './test-contracts';
import { gpuVendorIssue, sendMachineMessage } from './test-machine';
import { MAX_TEST_REPETITIONS, TEST_PROFILES, validateTestHistory } from './test-launch';

/** Includes warm-up and cleanup; a lost render loop must not leave an indefinitely running UI. */
const DEFAULT_RUN_TIMEOUT_MS = 180_000;
/** Cleanup has its own un-aborted context so cancelling work still restores the scene. */
const CLEANUP_TIMEOUT_MS = 5_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Abort-aware wait is shared by adapters; listeners and timers are removed on every exit path. */
export function waitForTest(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

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

function withSummary(metric: TestMetric): TestMetric {
  const summary = summarizeTestSamples(metric.samples);
  return summary ? { ...metric, summary } : metric;
}

async function abortable<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

/** One application-neutral executor drives the button, URL and later external adapters. */
export class TestSession<TSettings extends object, TSnapshot = unknown> {
  private running = false;

  async run(
    suiteInput: TestSuite<TSettings>, adapter: TestRunAdapter<TSettings, TSnapshot>, options: TestRunOptions,
    onProgress: (progress: TestProgress | null) => void = () => {}, externalSignal?: AbortSignal,
  ): Promise<TestRunResult<TSettings>> {
    if (this.running) throw new Error('A test is already running');
    validateTestHistory([suiteInput]);
    if (!TEST_PROFILES.includes(options.profile) || !Number.isInteger(options.repetitions) ||
        options.repetitions < 1 || options.repetitions > MAX_TEST_REPETITIONS ||
        !Number.isFinite(options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) || (options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) <= 0) {
      throw new Error('Invalid test run options');
    }
    // Retain resolved inputs even if the caller changes its history while a run is active.
    const suite = structuredClone(suiteInput);
    this.running = true;
    const startedAt = new Date().toISOString();
    const runId = globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`;
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('Run cancelled'));
    externalSignal?.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted) cancel();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Run timed out')); }, options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
    const cases: TestCaseResult<TSettings>[] = [];
    const errors: string[] = [];
    const environment: Record<string, TestSetting> = {};
    const doc = typeof document === 'undefined' ? undefined : document;
    const win = doc?.defaultView;
    const total = suite.scenarios.length * options.repetitions;
    const context = (signal: AbortSignal, repetition: number): TestContext => ({
      signal, profile: options.profile, repetition, wait: (ms) => waitForTest(ms, signal),
    });
    const machineSink = suite.purpose === 'performance' ? options.machineSink : undefined;
    const machineMessage = (kind: 'prepare' | 'start' | 'stop', scenarioId?: string, repetition?: number) =>
      sendMachineMessage(machineSink as string, kind, { runId, suiteId: suite.id, suiteVersion: suite.version, scenarioId, repetition });
    let snapshot: TSnapshot | undefined;
    let captured = false;
    let failed = false;
    const progress = (phase: TestProgress['phase'], repetition = 1, scenario?: typeof suite.scenarios[number]) =>
      onProgress({ phase, completed: cases.length, total, repetition, scenarioId: scenario?.id, label: scenario?.label });
    try {
      Object.assign(environment, {
        userAgent: win?.navigator.userAgent ?? 'unavailable',
        viewport: win ? `${win.innerWidth}x${win.innerHeight}` : 'unavailable',
        devicePixelRatio: win?.devicePixelRatio ?? null,
        buildFingerprint: 'unknown',
      }, adapter.environment?.());
      progress('preparing');
      // The receiver's slow preflight (power, other processes) runs now, not inside the first measurement.
      if (machineSink) void machineMessage('prepare');
      snapshot = await abortable(() => adapter.capture(context(controller.signal, 1)), controller.signal);
      captured = true;
      for (let repetition = 1; repetition <= options.repetitions; repetition++) {
        for (const scenario of suite.scenarios) {
          const validityIssues = new Set<string>();
          const checkVisibility = () => {
            if (options.profile !== 'headless-hardware') {
              if (doc?.visibilityState !== 'visible') validityIssues.add('Page was not visible');
              if (!doc?.hasFocus()) validityIssues.add('Page was not focused');
            }
          };
          const blurred = () => { if (options.profile !== 'headless-hardware') validityIssues.add('Page lost focus'); };
          const pageHidden = () => { validityIssues.add('Page navigation during measurement'); };
          let observing = false;
          let machineStarted: Promise<void> | undefined;
          try {
            const ctx = context(controller.signal, repetition);
            progress('applying', repetition, scenario);
            await abortable(() => adapter.apply(scenario, ctx), controller.signal);
            progress('ready', repetition, scenario);
            await abortable(() => adapter.ready(ctx, scenario), controller.signal);
            progress('warmup', repetition, scenario);
            await ctx.wait(scenario.warmupMs ?? 0);
            progress('measuring', repetition, scenario);
            checkVisibility();
            doc?.addEventListener('visibilitychange', checkVisibility);
            win?.addEventListener('blur', blurred);
            win?.addEventListener('pagehide', pageHidden);
            observing = true;
            if (machineSink) machineStarted = machineMessage('start', scenario.id, repetition);
            const observation = await abortable(() => adapter.measure(scenario, ctx), controller.signal);
            checkVisibility();
            if (suite.purpose === 'performance') for (const issue of observation.validityIssues ?? []) validityIssues.add(issue);
            if (suite.purpose === 'performance') {
              const gpuIssue = gpuVendorIssue(suite.expectedGpuVendor, environment);
              if (gpuIssue) validityIssues.add(gpuIssue);
            }
            if (options.profile === 'headless-hardware' && suite.purpose === 'performance') {
              validityIssues.add('Headless hardware/power profile was not independently verified');
            }
            if (suite.purpose === 'performance' && (!observation.metrics.some((metric) => !metric.optional) ||
                observation.metrics.some((metric) => metric.samples.some((sample) => !Number.isFinite(sample)) ||
                  (!metric.samples.length && !metric.optional)))) {
              validityIssues.add('Required metric samples unavailable or invalid');
            }
            const checks = observation.checks ?? [];
            const caseFailed = checks.some((check) => !check.passed);
            cases.push({ scenario, repetition, status: caseFailed ? 'failed' : 'completed', metrics: observation.metrics.map(withSummary),
              checks, validityIssues: [...validityIssues], limitations: observation.limitations ?? [], details: observation.details });
            if (caseFailed) { failed = true; throw new Error(`Checks failed: ${scenario.id}`); }
          } catch (error) {
            if (cases.at(-1)?.scenario.id !== scenario.id || cases.at(-1)?.repetition !== repetition) {
              cases.push({ scenario, repetition, status: controller.signal.aborted && !timedOut ? 'cancelled' : 'failed',
                metrics: [], checks: [], validityIssues: [...validityIssues], limitations: [], error: errorMessage(error) });
            }
            throw error;
          } finally {
            // Stop follows the start message's outcome, so a slow start cannot arrive after its stop.
            if (machineStarted) void machineStarted.then(() => machineMessage('stop', scenario.id, repetition));
            if (observing) {
              doc?.removeEventListener('visibilitychange', checkVisibility);
              win?.removeEventListener('blur', blurred);
              win?.removeEventListener('pagehide', pageHidden);
            }
          }
        }
      }
    } catch (error) {
      errors.push(errorMessage(error));
      if (!controller.signal.aborted || timedOut) failed = true;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', cancel);
      if (captured) {
        const cleanup = new AbortController();
        const cleanupTimer = setTimeout(() => cleanup.abort(new Error('Restoration timed out')), CLEANUP_TIMEOUT_MS);
        try {
          progress('restoring');
          await abortable(() => adapter.restore(snapshot as TSnapshot, context(cleanup.signal, 1)), cleanup.signal);
        } catch (error) { failed = true; errors.push(`Restoration failed: ${errorMessage(error)}`); }
        finally { clearTimeout(cleanupTimer); }
      }
      this.running = false;
      onProgress(null);
    }
    const inconclusive = cases.some((item) => item.validityIssues.length > 0);
    const cancelled = controller.signal.aborted && !timedOut;
    return {
      schemaVersion: 1, runId, suite, profile: options.profile, repetitions: options.repetitions, startedAt,
      finishedAt: new Date().toISOString(), status: failed ? 'failed' : cancelled ? 'cancelled' : inconclusive ? 'inconclusive' : 'completed',
      automatedVerdict: failed ? 'fail' : cancelled || !cases.length || cases.every((item) => !item.checks.length) ? 'not-run' : 'pass',
      performanceVerdict: suite.purpose !== 'performance' ? 'not-run' : failed || cancelled || inconclusive ? 'inconclusive' : 'unassessed',
      visualReview: suite.requiresVisualReview || options.profile === 'human-observed' ? 'pending' : 'not-required',
      environment, cases, errors,
    };
  }
}
