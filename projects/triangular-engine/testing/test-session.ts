import type {
  TestCaseResult, TestContext, TestMetric, TestProgress, TestRunAdapter, TestRunOptions, TestRunResult, TestSetting, TestSuite,
  TestAblationOutcome, TestWindow,
} from './test-contracts';
import { gpuVendorIssue, MACHINE_PREPARE_TIMEOUT_MS, sendMachineMessage } from './test-machine';
import { MAX_TEST_REPETITIONS, TEST_MODES, TEST_PROFILES, validateTestHistory } from './test-launch';
import { compareAblation } from './test-ablation';
import { summarizeTestSamples } from './test-stats';
import { assessPerformance } from './test-performance';
import { modeWarmupMs, modeWindowMs, runMeasureWindow } from './test-window';
import { keepThumbnails, THUMBNAIL_TIMEOUT_MS } from './test-thumbnails';
import { describeJsEngine } from './core/test-timer';

export { nearestRankPercentile, summarizeTestSamples } from './test-stats';

/** Added to every case of a CPU-evidence suite, so no reader mistakes it for a GPU or hardware-profile number. */
export const CPU_ONLY_LIMITATION = 'CPU-only timing (suite evidence "cpu"): the GPU and hardware-profile checks were skipped; this is not GPU or hardware evidence';

/** Includes warm-up and cleanup; a lost render loop must not leave an indefinitely running UI. Paused time is not counted. */
const DEFAULT_RUN_TIMEOUT_MS = 180_000;
/** Cleanup has its own un-aborted context so cancelling work still restores the scene. */
const CLEANUP_TIMEOUT_MS = 5_000;
/**
 * A case whose page is hidden or loses focus during warmup or measurement is stopped, and redone once the page is
 * visible and focused again, at most this many times. After that the loss is recorded as a validity issue. Only a
 * page that was visible and focused earlier in the run is waited for.
 */
export const MAX_FOCUS_RETRIES = 2;
/** A run paused for focus gives up after this long. */
export const FOCUS_RESUME_TIMEOUT_MS = 10 * 60_000;
const FOCUS_POLL_MS = 250;

/** Abort reason of a case attempt stopped because the page was hidden or lost focus. */
class FocusLost extends Error {}

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

/** `compareAblation` per group and metric over the suite's A/B rounds, in run order. */
export function ablationOutcomes<TSettings extends object>(
  suite: TestSuite<TSettings>, cases: readonly TestCaseResult<TSettings>[],
): TestAblationOutcome[] {
  const spec = suite.ablation;
  if (!spec) return [];
  const groups = [...new Set(suite.scenarios.flatMap((scenario) => scenario.ablation ? [scenario.ablation.group] : []))];
  return groups.flatMap((group) => {
    const rounds = cases.filter((item) => item.scenario.ablation?.group === group);
    const invalidRounds = rounds.filter((item) => item.validityIssues.length > 0 || item.status !== 'completed').length;
    return spec.metrics.map((metric) => ({
      group, feature: spec.feature, metric, invalidRounds,
      result: compareAblation(rounds.map((item) => ({
        arm: item.scenario.ablation!.arm,
        samples: item.metrics.find((candidate) => candidate.name === metric)?.samples ?? [],
      })), { statistic: spec.statistic, maxSpread: spec.maxSpread }),
    }));
  });
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
        !Number.isFinite(options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) || (options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) <= 0 ||
        !TEST_MODES.includes(options.mode ?? 'standard')) {
      throw new Error('Invalid test run options');
    }
    const mode = options.mode ?? 'standard';
    if (mode !== 'standard' && !adapter.windowModes) throw new Error(`This page's tests run fixed-length windows; use standard mode, not ${mode}`);
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
    const total = suite.scenarios.length * options.repetitions;
    // The default budget is a fixed allowance for loading and settling plus every scenario's warm-up and window, so
    // long suites and soak windows fit.
    let remainingMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS +
      suite.scenarios.reduce((sum, scenario) => sum + (scenario.warmupMs ?? 0) + modeWindowMs(scenario, mode), 0) * options.repetitions;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timerStartedAt = 0;
    const resumeTimer = () => {
      timerStartedAt = Date.now();
      timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Run timed out')); }, Math.max(0, remainingMs));
    };
    const pauseTimer = () => { clearTimeout(timer); remainingMs -= Date.now() - timerStartedAt; };
    resumeTimer();
    const cases: TestCaseResult<TSettings>[] = [];
    const errors: string[] = [];
    const environment: Record<string, TestSetting> = {};
    const doc = typeof document === 'undefined' ? undefined : document;
    const win = doc?.defaultView;
    // A CPU-only suite or adapter has no render loop to protect: no focus watch, thumbnail or GPU validity rule.
    const cpuOnly = suite.evidence === 'cpu' || adapter.cpuOnly === true;
    const watchFocus = options.profile !== 'headless-hardware' && !!doc && !cpuOnly;
    const context = (signal: AbortSignal, repetition: number, onWindow?: (measured: TestWindow) => void): TestContext => ({
      signal, profile: options.profile, mode, repetition, wait: (ms) => waitForTest(ms, signal),
      measureWindow: async (scenario, series = []) => {
        const measured = await runMeasureWindow(scenario, mode, series, (ms) => waitForTest(ms, signal));
        onWindow?.(measured);
        return measured;
      },
    });
    let sawPage = false;
    const pageLost = (): string | undefined => !watchFocus ? undefined
      : doc?.visibilityState !== 'visible' ? 'Page was not visible' : !doc?.hasFocus() ? 'Page was not focused' : undefined;
    /** Waits, with the run timer paused, until the page is visible and focused. */
    const waitForPage = async (reason: string, repetition: number, scenario: typeof suite.scenarios[number], retry: number) => {
      if (!pageLost()) return;
      onProgress({ phase: 'paused', completed: cases.length, total, repetition, scenarioId: scenario.id, label: scenario.label,
        retry: retry || undefined, pausedReason: reason });
      pauseTimer();
      try {
        const began = Date.now();
        while (pageLost()) {
          if (Date.now() - began > FOCUS_RESUME_TIMEOUT_MS) throw new Error(`Page not back in focus after ${FOCUS_RESUME_TIMEOUT_MS / 60_000} min`);
          await waitForTest(FOCUS_POLL_MS, controller.signal);
        }
      } finally { resumeTimer(); }
    };
    const machineSink = suite.purpose === 'performance' ? options.machineSink : undefined;
    const machineMessage = (kind: 'prepare' | 'start' | 'stop', scenarioId?: string, repetition?: number, timeoutMs?: number) =>
      sendMachineMessage(machineSink as string, kind, { runId, suiteId: suite.id, suiteVersion: suite.version, scenarioId, repetition }, timeoutMs);
    // Thumbnails run after a kept case's measurement, with the run's own byte budget.
    let thumbnailBytes = 0;
    const takeThumbnails = async (scenario: typeof suite.scenarios[number], repetition: number): Promise<string[]> => {
      const attemptAbort = new AbortController();
      const forward = () => attemptAbort.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', forward, { once: true });
      if (controller.signal.aborted) forward();
      const giveUp = setTimeout(() => attemptAbort.abort(new Error(`timed out after ${THUMBNAIL_TIMEOUT_MS / 1000} s`)), THUMBNAIL_TIMEOUT_MS);
      try {
        const images = await abortable(() => adapter.thumbnail!(scenario, context(attemptAbort.signal, repetition)), attemptAbort.signal);
        if (!images?.length) return [];
        const kept = keepThumbnails(images, thumbnailBytes);
        thumbnailBytes += kept.bytes;
        if (kept.images.length) options.onThumbnails?.({ scenarioId: scenario.id, repetition, images: kept.images });
        return [...kept.notes];
      } catch (error) { return [`Thumbnail not taken: ${errorMessage(error)}`]; }
      finally { clearTimeout(giveUp); controller.signal.removeEventListener('abort', forward); }
    };
    let snapshot: TSnapshot | undefined;
    let captured = false;
    let failed = false;
    const progress = (phase: TestProgress['phase'], repetition = 1, scenario?: typeof suite.scenarios[number], retry = 0) =>
      onProgress({ phase, completed: cases.length, total, repetition, scenarioId: scenario?.id, label: scenario?.label, retry: retry || undefined });
    try {
      Object.assign(environment, {
        userAgent: win?.navigator.userAgent ?? 'unavailable',
        viewport: win ? `${win.innerWidth}x${win.innerHeight}` : 'unavailable',
        devicePixelRatio: win?.devicePixelRatio ?? null,
        buildFingerprint: 'unknown',
        jsEngine: describeJsEngine(),
        ...(cpuOnly ? { evidence: 'cpu-only' } : {}),
      }, adapter.environment?.());
      progress('preparing');
      // The receiver's slow preflight (power, other processes) runs now, not inside the first measurement. It overlaps
      // the capture, but the first case waits for its reply (bounded by MACHINE_PREPARE_TIMEOUT_MS; never rejects).
      const machinePrepared = machineSink ? machineMessage('prepare', undefined, undefined, MACHINE_PREPARE_TIMEOUT_MS) : undefined;
      snapshot = await abortable(() => adapter.capture(context(controller.signal, 1)), controller.signal);
      captured = true;
      if (machinePrepared) await abortable(() => machinePrepared, controller.signal);
      for (let repetition = 1; repetition <= options.repetitions; repetition++) {
        for (const scenario of suite.scenarios) {
          for (let retry = 0; ; retry++) {
            let canRetry = false;
            const attempt = new AbortController();
            const forward = () => attempt.abort(controller.signal.reason);
            controller.signal.addEventListener('abort', forward, { once: true });
            const validityIssues = new Set<string>();
            // Before the last attempt a lost page stops the attempt; on the last one it is recorded instead.
            const lost = (reason: string) => {
              if (canRetry) { if (!attempt.signal.aborted) attempt.abort(new FocusLost(reason)); }
              else validityIssues.add(reason);
            };
            const checkVisibility = () => { const reason = pageLost(); if (reason) lost(reason); };
            const blurred = () => { if (watchFocus) lost('Page lost focus'); };
            const pageHidden = () => { validityIssues.add('Page navigation during measurement'); };
            let observing = false;
            let machineStarted: Promise<void> | undefined;
            const stopObserving = () => {
              if (!observing) return;
              observing = false;
              doc?.removeEventListener('visibilitychange', checkVisibility);
              win?.removeEventListener('blur', blurred);
              win?.removeEventListener('pagehide', pageHidden);
            };
            // Stop follows the start message's outcome, so a slow start cannot arrive after its stop.
            const stopMachine = () => {
              const started = machineStarted;
              machineStarted = undefined;
              if (started) void started.then(() => machineMessage('stop', scenario.id, repetition));
            };
            let caseWindow: TestWindow | undefined;
            try {
              const ctx = context(attempt.signal, repetition, (value) => { caseWindow = value; });
              progress('applying', repetition, scenario, retry);
              await abortable(() => adapter.apply(scenario, ctx), attempt.signal);
              if (!cpuOnly) {
                progress('ready', repetition, scenario, retry);
                await abortable(() => adapter.ready(ctx, scenario), attempt.signal);
              }
              // A page someone was looking at earlier in this run waits here for them, without spending a retry. A page
              // that was never visible and focused (a headless or background run) is not waited for: the loss is
              // recorded instead, as it is on the last attempt.
              if (!pageLost()) sawPage = true;
              else if (sawPage) await waitForPage(pageLost() ?? '', repetition, scenario, retry);
              canRetry = watchFocus && sawPage && retry < MAX_FOCUS_RETRIES;
              doc?.addEventListener('visibilitychange', checkVisibility);
              win?.addEventListener('blur', blurred);
              win?.addEventListener('pagehide', pageHidden);
              observing = true;
              progress('warmup', repetition, scenario, retry);
              await ctx.wait(modeWarmupMs(scenario, mode));
              progress('measuring', repetition, scenario, retry);
              checkVisibility();
              if (machineSink) machineStarted = machineMessage('start', scenario.id, repetition);
              const observation = await abortable(() => adapter.measure(scenario, ctx), attempt.signal);
              checkVisibility();
              if (attempt.signal.aborted) throw attempt.signal.reason;
              // The attempt is kept. Whatever the thumbnail costs must stay outside the timing, the focus watch and the
              // machine block, so those are closed first.
              const thumbnailNotes: string[] = [];
              if (!cpuOnly && options.thumbnails !== false && options.onThumbnails && adapter.thumbnail) {
                stopObserving();
                stopMachine();
                thumbnailNotes.push(...await takeThumbnails(scenario, repetition));
              }
              if (suite.purpose === 'performance') for (const issue of observation.validityIssues ?? []) validityIssues.add(issue);
              if (suite.purpose === 'performance' && !cpuOnly) {
                const gpuIssue = gpuVendorIssue(suite.expectedGpuVendor, environment);
                if (gpuIssue) validityIssues.add(gpuIssue);
              }
              if (options.profile === 'headless-hardware' && suite.purpose === 'performance' && !cpuOnly) {
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
                checks, validityIssues: [...validityIssues], limitations: [...(observation.limitations ?? []), ...(cpuOnly && suite.purpose === 'performance' ? [CPU_ONLY_LIMITATION] : []), ...thumbnailNotes], details: observation.details,
                ...(caseWindow ? { window: caseWindow } : {}), ...(retry ? { retries: retry } : {}) });
              if (caseFailed) { failed = true; throw new Error(`Checks failed: ${scenario.id}`); }
              break;
            } catch (error) {
              const reason = attempt.signal.reason;
              if (!controller.signal.aborted && reason instanceof FocusLost) {
                await waitForPage(reason.message, repetition, scenario, retry + 1);
                continue;
              }
              if (cases.at(-1)?.scenario.id !== scenario.id || cases.at(-1)?.repetition !== repetition) {
                cases.push({ scenario, repetition, status: controller.signal.aborted && !timedOut ? 'cancelled' : 'failed',
                  metrics: [], checks: [], validityIssues: [...validityIssues], limitations: [], error: errorMessage(error),
                  ...(retry ? { retries: retry } : {}) });
              }
              throw error;
            } finally {
              controller.signal.removeEventListener('abort', forward);
              stopMachine();
              stopObserving();
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
    // A run that stopped early has too few rounds to compare; its failure says more than an A/B line could.
    const ablations = suite.ablation && !failed && !cancelled ? ablationOutcomes(suite, cases) : undefined;
    const performance = assessPerformance(suite, mode, cases, environment, failed || cancelled);
    return {
      schemaVersion: 1, runId, suite, profile: options.profile, mode, repetitions: options.repetitions, startedAt,
      finishedAt: new Date().toISOString(), status: failed ? 'failed' : cancelled ? 'cancelled' : inconclusive ? 'inconclusive' : 'completed',
      automatedVerdict: failed ? 'fail' : cancelled || !cases.length || cases.every((item) => !item.checks.length) ? 'not-run' : 'pass',
      performanceVerdict: performance.verdict, ...(performance.notes.length ? { performanceNotes: performance.notes } : {}),
      visualReview: suite.requiresVisualReview || options.profile === 'human-observed' ? 'pending' : 'not-required',
      environment, cases: performance.cases, ...(ablations ? { ablations } : {}), errors,
    };
  }
}
