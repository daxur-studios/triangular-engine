import { ChangeDetectionStrategy, Component, computed, effect, inject, InjectionToken, input, signal, untracked } from '@angular/core';
import type { TestRunResult } from './test-contracts';
import { DEFAULT_TEST_SINK_PATH, digestTestRun } from './test-runner.component';
import {
  baselineCandidates, changeKind, compareToBaseline, defaultBaseline, filterRuns, formatChange, formatMetricValue, formatRunDate, imageUrl,
  indexUrl, metricKeys, pairCases, parseTestRunIndex, resultUrl, runCounts, runFilterOptions, runGpu, runKey, runMode, runTime, splitMetricKey,
  thumbnailFrames, type TestChangeKind, type TestRunFilter, type TestRunIndexCase, type TestRunIndexEntry,
} from './test-results';
import { TestThumbnailComponent } from './test-thumbnail.component';

/** `fetch` for the receiver, replaceable in a host's tests. */
export const TEST_RESULTS_FETCH = new InjectionToken<typeof fetch>('TEST_RESULTS_FETCH', {
  providedIn: 'root',
  factory: () => (input, init) => globalThis.fetch(input, init),
});

/** The cell of one metric of one case: median and p95, the change from the baseline, and room for a target bar. */
export interface TestMetricCell {
  readonly key: string;
  readonly name: string;
  readonly unit: string;
  readonly median: number;
  readonly p95: number;
  readonly samples: number;
  readonly changeText: string;
  readonly kind: TestChangeKind;
  readonly baselineText: string;
  /** Median over the target (`targets` input), 1 = on target; absent without a target. */
  readonly targetRatio?: number;
  readonly targetText?: string;
}

export interface TestCaseRow {
  readonly id: string;
  readonly label: string;
  readonly frames: readonly string[];
  readonly windowText: string;
  readonly notes: readonly string[];
  readonly failed: readonly string[];
  readonly invalid: readonly string[];
  readonly metrics: readonly TestMetricCell[];
}

export interface TestCompareRow {
  readonly id: string;
  readonly a?: { readonly frames: readonly string[]; readonly median?: number; readonly p95?: number };
  readonly b?: { readonly frames: readonly string[]; readonly median?: number; readonly p95?: number };
  readonly deltaText: string;
  readonly kind: TestChangeKind;
}

type View = 'list' | 'run' | 'compare';
const NO_BASELINE = 'none';
/** Metrics shown per case before "all metrics". */
const DEFAULT_METRICS = 4;

/** Past runs saved by the local result receiver: a list, one run with its change from a baseline, and two runs side by side. */
@Component({
  selector: 'tri-test-results',
  standalone: true,
  imports: [TestThumbnailComponent],
  templateUrl: './test-results.component.html',
  styleUrl: './test-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestResultsComponent {
  /** Where the result receiver is: the same-origin sink path (the dev proxy) or a full URL. The page can change it. */
  readonly receiver = input(DEFAULT_TEST_SINK_PATH);
  /**
   * Targets per metric key (`name (unit)`), in that metric's unit. A metric with a target gets a bar; none are built in:
   * budgets come from a separate task.
   */
  readonly targets = input<Readonly<Record<string, number>>>({});
  /** Loop multi-frame thumbnails without hover (not with reduced motion). */
  readonly autoplay = input(false);

  private readonly fetcher = inject(TEST_RESULTS_FETCH);
  private loadToken = 0;
  private detailToken = 0;

  readonly source = signal('');
  readonly runs = signal<readonly TestRunIndexEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly filter = signal<TestRunFilter>({ suite: '', mode: '', gpu: '' });
  readonly view = signal<View>('list');
  readonly selectedFile = signal<string | null>(null);
  /** `undefined` follows the default (the previous matching run); `none` shows no change. */
  readonly baselineChoice = signal<string | undefined>(undefined);
  readonly detail = signal<{ state: 'loading' | 'ready' | 'missing'; run?: TestRunResult<object> }>({ state: 'loading' });
  readonly metricFilter = signal('');
  readonly allMetrics = signal(false);
  readonly picks = signal<readonly string[]>([]);
  readonly compareA = signal<string | null>(null);
  readonly compareB = signal<string | null>(null);
  readonly compareMetric = signal('');

  readonly options = computed(() => runFilterOptions(this.runs()));
  readonly visible = computed(() => filterRuns(this.runs(), this.filter()));
  readonly selected = computed(() => this.runs().find((run) => run.file === this.selectedFile()));
  readonly baselines = computed(() => { const run = this.selected(); return run ? baselineCandidates(this.runs(), run) : []; });
  readonly baseline = computed(() => {
    const run = this.selected();
    const choice = this.baselineChoice();
    if (!run || choice === NO_BASELINE) return undefined;
    return choice ? this.runs().find((other) => other.file === choice) : defaultBaseline(this.runs(), run);
  });
  readonly digest = computed(() => { const run = this.detail().run; return run ? digestTestRun(run) : null; });
  readonly rows = computed<readonly TestCaseRow[]>(() => this.buildRows());
  readonly hiddenMetrics = computed(() => this.rows().reduce((sum, row) => sum + row.metrics.length, 0) - this.shownCount());
  readonly runA = computed(() => this.runs().find((run) => run.file === this.compareA()));
  readonly runB = computed(() => this.runs().find((run) => run.file === this.compareB()));
  readonly compareKeys = computed(() => { const a = this.runA(); const b = this.runB(); return a && b ? metricKeys(a, b) : []; });
  readonly compareRows = computed<readonly TestCompareRow[]>(() => this.buildCompare());

  readonly runKey = runKey;
  readonly runMode = runMode;
  readonly runGpu = runGpu;
  readonly runCounts = runCounts;
  readonly formatRunDate = formatRunDate;

  constructor() {
    effect(() => {
      const receiver = this.receiver();
      untracked(() => { this.source.set(receiver); void this.load(); });
    });
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    const source = this.source();
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await this.fetcher(indexUrl(source));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const runs = parseTestRunIndex(await response.json());
      if (token !== this.loadToken) return;
      this.runs.set(runs);
      if (this.view() !== 'list' && !this.selected() && !this.runA()) this.view.set('list');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.runs.set([]);
      this.error.set(`Could not read results from ${source || 'the receiver'} (${error instanceof Error ? error.message : String(error)}). Start the receiver with npm run test:receiver, or correct the URL.`);
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  setSource(value: string): void {
    this.source.set(value);
    void this.load();
  }

  setFilter(field: keyof TestRunFilter, value: string): void { this.filter.update((current) => ({ ...current, [field]: value })); }

  togglePick(file: string): void {
    this.picks.update((current) => current.includes(file) ? current.filter((item) => item !== file) : [...current, file].slice(-2));
  }

  openCompare(): void {
    const picked = this.picks().map((file) => this.runs().find((run) => run.file === file)).filter((run): run is TestRunIndexEntry => !!run);
    if (picked.length !== 2) return;
    // A is the older run, so the change reads as "what the newer run did".
    const [older, newer] = picked.sort((x, y) => runTime(x) - runTime(y));
    this.compareA.set(older.file);
    this.compareB.set(newer.file);
    this.compareMetric.set(this.compareKeys()[0] ?? '');
    this.view.set('compare');
  }

  setCompare(side: 'a' | 'b', file: string): void {
    (side === 'a' ? this.compareA : this.compareB).set(file);
    if (!this.compareKeys().includes(this.compareMetric())) this.compareMetric.set(this.compareKeys()[0] ?? '');
  }

  async open(file: string): Promise<void> {
    const token = ++this.detailToken;
    this.selectedFile.set(file);
    this.baselineChoice.set(undefined);
    this.metricFilter.set('');
    this.allMetrics.set(false);
    this.view.set('run');
    this.detail.set({ state: 'loading' });
    try {
      const response = await this.fetcher(resultUrl(this.source(), file));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const run = await response.json() as TestRunResult<object>;
      if (token === this.detailToken) this.detail.set({ state: 'ready', run });
    } catch {
      if (token === this.detailToken) this.detail.set({ state: 'missing' });
    }
  }

  back(): void { this.view.set('list'); }

  thumbnailUrls(frames: readonly string[]): string[] { return frames.map((file) => imageUrl(this.source(), file)); }

  /** Whether the matching metrics of a case show: the first few until "all metrics", or those matching the filter. */
  private shownCount(): number {
    return this.rows().reduce((sum, row) => sum + this.visibleMetrics(row).length, 0);
  }

  visibleMetrics(row: TestCaseRow): readonly TestMetricCell[] {
    const text = this.metricFilter().trim().toLowerCase();
    const matching = text ? row.metrics.filter((cell) => cell.key.toLowerCase().includes(text)) : row.metrics;
    return this.allMetrics() || text ? matching : matching.slice(0, DEFAULT_METRICS);
  }

  tone(value: string): string {
    return ['pass', 'completed', 'accepted', 'not-required'].includes(value) ? 'ok'
      : ['fail', 'failed', 'rejected'].includes(value) ? 'bad' : ['inconclusive', 'pending', 'cancelled'].includes(value) ? 'warn' : 'muted';
  }

  runLabel(run: TestRunIndexEntry): string {
    return `${runKey(run)} · ${runMode(run)} · ${formatRunDate(run.startedAt ?? run.savedAt)} · ${run.head}`;
  }

  /** Baseline caption, with a warning when the adapter differs: timings of two GPUs are not comparable. */
  baselineNote(run: TestRunIndexEntry, baseline: TestRunIndexEntry): string {
    return runGpu(run) !== runGpu(baseline) ? `Different GPU adapter (${runGpu(baseline)}): the change is not a like-for-like comparison.` : '';
  }

  private caseNotes(item: TestRunIndexCase): string[] {
    const notes: string[] = [];
    if (item.retries) notes.push(`redone ${item.retries}x after the page lost focus`);
    if (item.window?.stoppedBy === 'max') notes.push('did not settle within its window');
    for (const [name, drift] of Object.entries(item.window?.drift ?? {})) {
      if (Math.abs(drift) > 0.05) notes.push(`${name} drifted ${drift > 0 ? '+' : ''}${(drift * 100).toFixed(1)}%`);
    }
    return notes;
  }

  private buildRows(): TestCaseRow[] {
    const run = this.selected();
    if (!run) return [];
    const baseline = this.baseline();
    const changes = baseline ? compareToBaseline(run, baseline) : {};
    const labels = new Map((this.detail().run?.suite.scenarios ?? []).map((scenario) => [scenario.id, scenario.label]));
    const targets = this.targets();
    return Object.entries(run.cases).map(([id, item]) => ({
      id,
      label: labels.get(id) ?? id,
      frames: thumbnailFrames(item.thumbnails),
      windowText: item.window ? `${item.window.stoppedBy} · ${item.window.s.toFixed(1)} s` : '',
      notes: this.caseNotes(item),
      failed: item.failed,
      invalid: item.invalid,
      metrics: Object.entries(item.metrics).map(([key, metric]): TestMetricCell => {
        const { name, unit } = splitMetricKey(key);
        const change = changes[id]?.[key];
        const target = targets[key];
        return {
          key, name, unit, median: metric.med, p95: metric.p95, samples: metric.n,
          changeText: baseline ? formatChange(change?.change) : '', kind: baseline ? changeKind(change?.change, unit) : 'none',
          baselineText: change ? `baseline median ${formatMetricValue(change.baseMedian)}, p95 ${formatMetricValue(change.baseP95)} ${unit}` : 'not in the baseline',
          ...(target ? { targetRatio: metric.med / target, targetText: `target ${formatMetricValue(target)} ${unit}` } : {}),
        };
      }),
    }));
  }

  private buildCompare(): TestCompareRow[] {
    const a = this.runA();
    const b = this.runB();
    const key = this.compareMetric();
    if (!a || !b) return [];
    const unit = splitMetricKey(key).unit;
    const side = (item: TestRunIndexCase | undefined) => item ? { frames: thumbnailFrames(item.thumbnails), median: item.metrics[key]?.med, p95: item.metrics[key]?.p95 } : undefined;
    return pairCases(a, b).map(({ id, a: itemA, b: itemB }) => {
      const before = itemA?.metrics[key]?.med;
      const after = itemB?.metrics[key]?.med;
      const change = before !== undefined && after !== undefined && before !== 0 ? (after - before) / before : undefined;
      return { id, a: side(itemA), b: side(itemB), deltaText: formatChange(change), kind: changeKind(change, unit) };
    });
  }

  fmt(value: number | undefined): string { return value === undefined ? 'n/a' : formatMetricValue(value); }
  unitOf(key: string): string { return splitMetricKey(key).unit; }
  nameOf(key: string): string { return splitMetricKey(key).name; }
  barWidth(ratio: number | undefined): number { return Math.min(100, Math.max(0, (ratio ?? 0) * 100 / 1.5)); }
}
