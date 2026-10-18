import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { TestMetric, TestProfile, TestProgress, TestRunAdapter, TestRunResult, TestSuite } from './test-contracts';
import { buildTestLaunchUrl, MAX_TEST_REPETITIONS, parseTestLaunch, TEST_PROFILES, testSuiteKey, validateTestHistory } from './test-launch';
import { TestSession } from './test-session';

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
  readonly progressChange = output<TestProgress | null>();
  readonly completed = output<TestRunResult<TSettings>>();

  readonly profiles = TEST_PROFILES;
  readonly maxRepetitions = MAX_TEST_REPETITIONS;
  readonly form = new FormGroup({
    suite: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    repetitions: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(MAX_TEST_REPETITIONS), Validators.pattern(/^\d+$/)] }),
    profile: new FormControl<TestProfile>('visible-browser', { nonNullable: true }),
  });
  readonly reviewNotes = new FormControl('', { nonNullable: true });
  readonly progress = signal<TestProgress | null>(null);
  readonly running = signal(false);
  readonly result = signal<TestRunResult<TSettings> | null>(null);
  readonly message = signal('');
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
      const launch = parseTestLaunch(new URL(this.doc.location.href), this.suites());
      if (launch) {
        this.form.setValue({ suite: launch.key, repetitions: launch.repetitions, profile: launch.profile });
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
    this.reviewNotes.reset();
    this.message.set('');
    this.activeSuite.set(suite);
    this.abort = new AbortController();
    try {
      const result = await this.session.run(suite, this.adapter(), options, (progress) => {
        if (this.destroyed) return;
        this.progress.set(progress);
        this.progressChange.emit(progress);
      }, this.abort.signal);
      if (!this.destroyed) {
        const withLink = { ...result, rerunUrl: buildTestLaunchUrl(this.doc.location.href, result.suite, options.profile, options.repetitions) };
        this.result.set(withLink);
        this.completed.emit(withLink);
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
  }

  /** Summaries are over provider readings, which may be batched; no GPU-pass attribution is inferred. */
  metricText(metric: TestMetric): string {
    if (!metric.samples.length) return `${metric.name}: unavailable (${metric.unavailableReason ?? 'no readings'})`;
    if (metric.samples.some((sample) => !Number.isFinite(sample))) return `${metric.name}: invalid readings`;
    const sorted = [...metric.samples].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    return `${metric.name}: mean ${mean.toFixed(2)}, p95 ${p95.toFixed(2)} ${metric.unit} · ${sorted.length} provider readings`;
  }

  async copyResult(): Promise<void> {
    try { await this.doc.defaultView?.navigator.clipboard.writeText(this.resultText()); this.message.set('Result copied'); }
    catch { this.message.set('Clipboard unavailable; select the result text or download JSON.'); }
  }

  async copyLaunchLink(): Promise<void> {
    const suite = this.suites().find((item) => testSuiteKey(item) === this.form.controls.suite.value);
    if (!suite) return;
    const options = this.form.getRawValue();
    const url = buildTestLaunchUrl(this.doc.location.href, suite, options.profile, options.repetitions);
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
