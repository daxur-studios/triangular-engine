import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, isDevMode, OnInit, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { TestAblationOutcome, TestCaseThumbnails, TestMetric, TestMode, TestProfile, TestProgress, TestRunAdapter, TestRunResult, TestSuite } from './test-contracts';
import { buildTestLaunchUrl, MAX_TEST_REPETITIONS, parseTestLaunch, TEST_MODES, TEST_PROFILES, testSuiteKey, validateTestHistory } from './test-launch';
import { nearestRankPercentile, TestSession } from './test-session';
import { encodeThumbnailUploads } from './test-thumbnails';

/** Same-origin path the dev-server proxy forwards to the result receiver. */
export const DEFAULT_TEST_SINK_PATH = '/__triangular-test-sink';
/** A soak series whose median moved more than this from the first to the last quarter is reported as drift. */
export const SOAK_DRIFT_WARNING = 0.05;

/** Counts and problems of a finished run, for the one-card result and the agent hand-off. */
export interface TestRunDigest {
  readonly valid: number;
  readonly invalid: number;
  readonly failed: number;
  readonly seconds: number;
  /** One line per problem: failed checks, errors and validity issues, then warnings (redone, unsettled, drift). */
  readonly problems: readonly string[];
  readonly warnings: number;
  /** One line per A/B comparison (`TestRunResult.ablations`). */
  readonly ablations: readonly string[];
}

/** `shadows @ orbit-600km, gpuPassTotal: B 0.081 vs A 0.045 ms (+80.0%), slower, noise ±0.001`. */
export function ablationText(outcome: TestAblationOutcome): string {
  const { result } = outcome;
  const head = `${outcome.feature} @ ${outcome.group}, ${outcome.metric} ${result.statistic}`;
  const invalid = outcome.invalidRounds ? ` · ${outcome.invalidRounds} invalid rounds` : '';
  if (result.verdict === 'invalid' || result.verdict === 'rejected') return `${head}: ${result.verdict} (${result.reasons.join('; ')})${invalid}`;
  const pct = Number.isFinite(result.relative) ? ` (${result.relative > 0 ? '+' : ''}${(result.relative * 100).toFixed(1)}%)` : '';
  return `${head}: B ${result.b.value.toFixed(3)} vs A ${result.a.value.toFixed(3)}${pct}, ${result.verdict}, noise ±${result.noiseBand.toFixed(3)}${invalid}`;
}

export function digestTestRun(run: TestRunResult<object>): TestRunDigest {
  const problems: string[] = [];
  let warnings = 0;
  let valid = 0, invalid = 0, failed = 0;
  for (const item of run.cases) {
    const id = run.repetitions > 1 ? `${item.scenario.id} #${item.repetition}` : item.scenario.id;
    if (item.status !== 'completed') failed++;
    else if (item.validityIssues.length) invalid++;
    else valid++;
    for (const check of item.checks) if (!check.passed) problems.push(`${id}: failed ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    if (item.error) problems.push(`${id}: ${item.error}`);
    for (const issue of item.validityIssues) problems.push(`${id}: invalid, ${issue}`);
    const notes: string[] = [];
    if (item.retries) notes.push(`redone ${item.retries}x after the page lost focus`);
    if (item.window?.mode === 'quick' && item.window.stoppedBy === 'max') notes.push('did not settle within its window');
    for (const [name, drift] of Object.entries(item.window?.drift ?? {})) {
      if (Math.abs(drift) > SOAK_DRIFT_WARNING) notes.push(`${name} drifted ${drift > 0 ? '+' : ''}${(drift * 100).toFixed(1)}%`);
    }
    warnings += notes.length;
    for (const note of notes) problems.push(`${id}: ${note}`);
  }
  // `Checks failed: <id>` only repeats the failed check lines above.
  const failedIds = new Set(run.cases.filter((item) => item.checks.some((check) => !check.passed)).map((item) => item.scenario.id));
  for (const error of run.errors) {
    if (failedIds.has(error.replace(/^Checks failed: /, '')) || problems.some((line) => line.endsWith(error))) continue;
    problems.push(error);
  }
  const seconds = Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  return { valid, invalid, failed, seconds, problems, warnings, ablations: (run.ablations ?? []).map(ablationText) };
}

/** The few lines an agent needs to find and read a run; the full result stays in the saved file. */
export function testRunAgentText(run: TestRunResult<object>, savedFile?: string): string {
  const digest = digestTestRun(run);
  const reps = `${run.repetitions} repetition${run.repetitions > 1 ? 's' : ''}`;
  return [
    `Test run finished: ${testSuiteKey(run.suite)} (${run.mode ?? 'standard'} mode, ${run.profile}, ${reps})`,
    `Status: ${run.status} · automation ${run.automatedVerdict} · performance ${run.performanceVerdict} · visual review ${run.visualReview}`,
    `Cases: ${digest.valid} valid, ${digest.invalid} invalid, ${digest.failed} failed · ${digest.seconds.toFixed(0)} s`,
    savedFile ? `Result file: ${savedFile}` : 'Result file: not saved (download the JSON from the runner)',
    `Read: npm run test:summary '--' --suite ${run.suite.id} --last 1`,
    ...digest.ablations.map((line) => `A/B ${line}`),
    ...digest.problems.map((line) => `- ${line}`),
  ].join('\n');
}

/** Portable test UI: the host supplies data and actions; this entry imports no renderer or automation client. */
@Component({
  selector: 'tri-test-runner',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './test-runner.component.html',
  styleUrl: './test-runner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestRunnerComponent<TSettings extends object = Record<string, unknown>, TSnapshot = unknown> implements OnInit {
  readonly suites = input.required<readonly TestSuite<TSettings>[]>();
  readonly adapter = input.required<TestRunAdapter<TSettings, TSnapshot>>();
  /** Readiness must be supplied by the page, not inferred from network-idle. */
  readonly available = input(true);
  readonly externalBusy = input(false);
  /** Query selection is safe data; autostart still requires explicit application opt-in. */
  readonly allowAutoStart = input(false);
  /**
   * Durable save, on by default in dev builds (production never posts). `true` posts to the same-origin
   * `DEFAULT_TEST_SINK_PATH`; a string is a custom URL; `false` opts out. Each finished run, and each visual review of
   * it, is POSTed as JSON; failure is shown, never silent.
   */
  readonly resultSink = input<boolean | string>(true);
  readonly progressChange = output<TestProgress | null>();
  readonly completed = output<TestRunResult<TSettings>>();

  readonly profiles = TEST_PROFILES;
  /** Quick and soak need an adapter that times its windows with `measureWindow`. */
  readonly modes = computed<readonly TestMode[]>(() => this.adapter().windowModes ? TEST_MODES : ['standard']);
  readonly maxRepetitions = MAX_TEST_REPETITIONS;
  readonly form = new FormGroup({
    suite: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    repetitions: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(MAX_TEST_REPETITIONS), Validators.pattern(/^\d+$/)] }),
    profile: new FormControl<TestProfile>('visible-browser', { nonNullable: true }),
    mode: new FormControl<TestMode>('standard', { nonNullable: true }),
    /** Small pictures of what each case looks at, saved with the result (needs the result sink). */
    thumbnails: new FormControl(true, { nonNullable: true }),
  });
  readonly reviewNotes = new FormControl('', { nonNullable: true });
  readonly progress = signal<TestProgress | null>(null);
  readonly running = signal(false);
  readonly result = signal<TestRunResult<TSettings> | null>(null);
  readonly message = signal('');
  /** Outcome of the last sink save: empty when the sink is off. */
  readonly saveStatus = signal('');
  /** Stored file name the receiver returned for the last save. */
  readonly savedFile = signal<string | undefined>(undefined);
  readonly digest = computed(() => { const run = this.result(); return run ? digestTestRun(run) : null; });
  readonly agentText = computed(() => { const run = this.result(); return run ? testRunAgentText(run, this.savedFile()) : ''; });
  /** Fraction of cases done, for the progress bar. */
  readonly progressFraction = computed(() => { const state = this.progress(); return state && state.total ? state.completed / state.total : 0; });
  readonly latest = computed(() => this.suites().at(-1));
  readonly activeSuite = signal<TestSuite<TSettings> | null>(null);
  readonly resultText = computed(() => JSON.stringify(this.result(), null, 2));
  readonly activeSettings = computed(() => {
    const id = this.progress()?.scenarioId;
    return JSON.stringify(this.activeSuite()?.scenarios.find((scenario) => scenario.id === id)?.settings ?? {}, null, 2);
  });
  readonly suiteKey = testSuiteKey;
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = new TestSession<TSettings, TSnapshot>();
  private readonly initialized = signal(false);
  private pendingAutoStart = false;
  private destroyed = false;
  private abort?: AbortController;

  constructor() {
    effect(() => {
      if (this.initialized() && this.available() && !this.externalBusy() && this.pendingAutoStart && !this.running()) {
        this.pendingAutoStart = false;
        void this.runSelected();
      }
    });
    this.destroyRef.onDestroy(() => { this.destroyed = true; this.abort?.abort(); });
  }

  ngOnInit(): void {
    try {
      validateTestHistory(this.suites());
      const latest = this.latest();
      if (latest) this.form.controls.suite.setValue(testSuiteKey(latest));
      // Quick by default where the page supports it: the runner is mostly for checking work as you go.
      if (this.adapter().windowModes) this.form.controls.mode.setValue('quick');
      const launch = parseTestLaunch(new URL(this.doc.location.href), this.suites());
      if (launch) {
        if (!this.modes().includes(launch.mode)) throw new Error(`This page runs standard mode only, not ${launch.mode}`);
        this.form.setValue({ suite: launch.key, repetitions: launch.repetitions, profile: launch.profile, mode: launch.mode, thumbnails: launch.thumbnails });
        if (launch.autoStart && !this.allowAutoStart()) this.message.set('Autostart is disabled by this application. Use Run selected.');
        this.pendingAutoStart = launch.autoStart && this.allowAutoStart();
      }
    } catch (error) { this.message.set(error instanceof Error ? error.message : String(error)); }
    this.initialized.set(true);
  }

  runLatest(): Promise<void> {
    if (this.running()) return Promise.resolve();
    const latest = this.latest();
    if (latest) this.form.controls.suite.setValue(testSuiteKey(latest));
    return this.runSelected();
  }

  async runSelected(): Promise<void> {
    if (this.running() || !this.available() || this.externalBusy() || this.form.invalid) return;
    const options = this.form.getRawValue();
    const suite = this.suites().find((item) => testSuiteKey(item) === options.suite);
    if (!suite) { this.message.set('Unknown test selection'); return; }
    this.running.set(true);
    this.form.disable({ emitEvent: false });
    this.result.set(null);
    this.savedFile.set(undefined);
    this.saveStatus.set('');
    this.reviewNotes.reset();
    this.message.set('');
    this.activeSuite.set(suite);
    this.abort = new AbortController();
    try {
      const sink = this.resultSink();
      const machineSink = sink && isDevMode() ? (typeof sink === 'string' ? sink : DEFAULT_TEST_SINK_PATH) : undefined;
      // Pictures go only to the receiver, so without one they are not taken.
      const thumbnails: TestCaseThumbnails[] = [];
      const onThumbnails = machineSink && options.thumbnails ? (entry: TestCaseThumbnails) => { thumbnails.push(entry); } : undefined;
      const result = await this.session.run(suite, this.adapter(), { ...options, machineSink, onThumbnails }, (progress) => {
        if (this.destroyed) return;
        this.progress.set(progress);
        this.progressChange.emit(progress);
      }, this.abort.signal);
      if (!this.destroyed) {
        const withLink = { ...result, rerunUrl: buildTestLaunchUrl(this.doc.location.href, result.suite, options.profile, options.repetitions, options.mode, options.thumbnails) };
        this.result.set(withLink);
        this.completed.emit(withLink);
        void this.saveResult(withLink, thumbnails);
      }
    } catch (error) {
      if (!this.destroyed) this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
      this.form.enable({ emitEvent: false });
    }
  }

  cancel(): void { this.abort?.abort(); }

  /** Reviewer acceptance is explicit and never inferred from automated completion. */
  review(verdict: 'accepted' | 'rejected'): void {
    const result = this.result();
    if (!result || result.visualReview !== 'pending' || result.status === 'failed' || result.status === 'cancelled') return;
    const reviewed = { ...result, visualReview: verdict, reviewNotes: this.reviewNotes.value };
    this.result.set(reviewed);
    this.completed.emit(reviewed);
    void this.saveResult(reviewed, []);
  }

  /** `thumbnails` ride in the same POST as base64 `thumbnailUploads`; the result JSON the panel shows and copies never has them. */
  private async saveResult(result: TestRunResult<TSettings>, thumbnails: readonly TestCaseThumbnails[]): Promise<void> {
    const sink = this.resultSink();
    if (!sink || !isDevMode()) { this.saveStatus.set(''); return; }
    const url = typeof sink === 'string' ? sink : DEFAULT_TEST_SINK_PATH;
    const failed = 'Result not saved (receiver unreachable): use Download JSON.';
    try {
      const thumbnailUploads = thumbnails.length ? await encodeThumbnailUploads(thumbnails) : undefined;
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(thumbnailUploads ? { ...result, thumbnailUploads } : result) });
      const body = response.ok ? await response.json().catch(() => ({})) as { file?: string; thumbnails?: readonly string[]; dropped?: readonly string[] } : null;
      if (this.destroyed) return;
      this.savedFile.set(body?.file);
      const images = body?.thumbnails?.length ? ` with ${body.thumbnails.length} thumbnail${body.thumbnails.length > 1 ? 's' : ''}` : '';
      const dropped = body?.dropped?.length ? `; ${body.dropped.length} thumbnail${body.dropped.length > 1 ? 's' : ''} dropped (${body.dropped[0]})` : '';
      this.saveStatus.set(body ? `Result saved${body.file ? `: ${body.file}` : ''}${images}${dropped}` : `${failed} (HTTP ${response.status})`);
    } catch { if (!this.destroyed) this.saveStatus.set(failed); }
  }

  /** Summaries are over provider readings, which may be batched; no GPU-pass attribution is inferred. */
  metricText(metric: TestMetric): string {
    if (!metric.samples.length) return `${metric.name}: unavailable (${metric.unavailableReason ?? 'no readings'})`;
    if (metric.samples.some((sample) => !Number.isFinite(sample))) return `${metric.name}: invalid readings`;
    const mean = metric.samples.reduce((sum, value) => sum + value, 0) / metric.samples.length;
    const p95 = nearestRankPercentile([...metric.samples].sort((a, b) => a - b), 0.95);
    return `${metric.name}: mean ${mean.toFixed(2)}, p95 ${p95.toFixed(2)} ${metric.unit} · ${metric.samples.length} provider readings`;
  }

  /** Copies the short hand-off text: suite, mode, verdicts, the saved file and every problem. */
  async copyForAgent(): Promise<void> {
    try { await this.doc.defaultView?.navigator.clipboard.writeText(this.agentText()); this.message.set('Copied for the agent'); }
    catch { this.message.set('Clipboard unavailable; select the text under Details.'); }
  }

  /** The card shows at most this many problem lines; Details and the agent text have them all. */
  readonly maxProblemLines = 8;

  caseText(state: TestProgress): string {
    const current = state.phase === 'preparing' || state.phase === 'restoring' ? state.completed : Math.min(state.total, state.completed + 1);
    return `${current} of ${state.total}${state.label ? ` · ${state.label}` : ''}`;
  }

  phaseText(state: TestProgress): string {
    if (state.phase === 'paused') return `Paused: ${state.pausedReason || 'page away'}. Come back to this tab to continue.`;
    return `${state.phase}${state.retry ? ` · redo ${state.retry}` : ''}`;
  }

  async copyResult(): Promise<void> {
    try { await this.doc.defaultView?.navigator.clipboard.writeText(this.resultText()); this.message.set('Result copied'); }
    catch { this.message.set('Clipboard unavailable; select the result text or download JSON.'); }
  }

  async copyLaunchLink(): Promise<void> {
    const suite = this.suites().find((item) => testSuiteKey(item) === this.form.controls.suite.value);
    if (!suite) return;
    const options = this.form.getRawValue();
    const url = buildTestLaunchUrl(this.doc.location.href, suite, options.profile, options.repetitions, options.mode, options.thumbnails);
    try { await this.doc.defaultView?.navigator.clipboard.writeText(url); this.message.set('Exact-version launch link copied'); }
    catch { this.message.set(url); }
  }

  downloadResult(): void {
    const result = this.result();
    if (!result) return;
    const url = URL.createObjectURL(new Blob([this.resultText()], { type: 'application/json' }));
    const link = this.doc.createElement('a');
    link.href = url;
    link.download = `${result.suite.id}-v${result.suite.version}-${result.runId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
