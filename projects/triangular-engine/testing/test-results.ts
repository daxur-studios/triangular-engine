import type { TestMode } from './test-contracts';

/** Nearest-rank statistics of one metric in a run's index line (`npm run test:summary` reads the same). */
export interface TestRunIndexMetric {
  readonly n: number;
  readonly min: number;
  readonly med: number;
  readonly p95: number;
  readonly max: number;
  /** A breakdown metric (see `TestMetric.group`): its group and its mean share of the group's total, 0..1. */
  readonly group?: string;
  readonly share?: number;
}

/** One scenario across the run's repetitions, as the receiver writes it to `index.jsonl`. */
export interface TestRunIndexCase {
  /** Keyed `name (unit)`. */
  readonly metrics: Readonly<Record<string, TestRunIndexMetric>>;
  readonly failed: readonly string[];
  readonly invalid: readonly string[];
  readonly window?: { readonly stoppedBy: 'settled' | 'max' | 'fixed'; readonly s: number; readonly drift?: Readonly<Record<string, number>> };
  readonly retries?: number;
  /** File names relative to the receiver's output folder. */
  readonly thumbnails?: readonly string[];
}

/** One line of the receiver's `index.jsonl`. */
export interface TestRunIndexEntry {
  readonly savedAt: string;
  readonly startedAt?: string;
  readonly suite: string;
  readonly version: number;
  readonly profile: string;
  readonly mode?: TestMode;
  readonly repetitions?: number;
  readonly runId: string;
  readonly fingerprint: string;
  readonly head: string;
  readonly status: string;
  readonly automatedVerdict: string;
  readonly performanceVerdict: string;
  readonly visualReview: string;
  /** Result file, relative to the receiver's output folder. */
  readonly file: string;
  readonly errors: readonly string[];
  readonly cases: Readonly<Record<string, TestRunIndexCase>>;
  readonly gpu?: string;
  readonly gpuBackend?: string;
  readonly machine?: { readonly warnings?: readonly string[] };
}

export interface TestRunFilter {
  /** Suite id, or '' for every suite. */
  readonly suite: string;
  readonly mode: string;
  readonly gpu: string;
}

export const NO_GPU_LABEL = 'not recorded';
/** A median that moved by more than this against the baseline is shown as a change worth reading. */
export const CHANGE_NOTICE = 0.05;

/** The receiver's index, newest run first. Lines that are not runs are skipped. */
export function parseTestRunIndex(body: unknown): TestRunIndexEntry[] {
  const list = (body as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(list)) throw new Error('Not a test result index');
  return list.filter((item): item is TestRunIndexEntry => !!item && typeof item === 'object' && typeof item.file === 'string' &&
    typeof item.suite === 'string' && Number.isFinite(item.version) && typeof item.runId === 'string' && !!item.cases && typeof item.cases === 'object')
    // Lines written by older receivers lack some keys.
    .map((item) => ({
      ...item, errors: item.errors ?? [],
      cases: Object.fromEntries(Object.entries(item.cases).map(([id, entry]) => [id, { ...entry, metrics: entry?.metrics ?? {}, failed: entry?.failed ?? [], invalid: entry?.invalid ?? [] }])),
    }))
    .sort((a, b) => runTime(b) - runTime(a));
}

export const runTime = (run: Pick<TestRunIndexEntry, 'startedAt' | 'savedAt'>): number => Date.parse(run.startedAt ?? run.savedAt) || 0;
export const runMode = (run: Pick<TestRunIndexEntry, 'mode'>): TestMode => run.mode ?? 'standard';
export const runGpu = (run: Pick<TestRunIndexEntry, 'gpu' | 'gpuBackend'>): string =>
  run.gpu ? `${run.gpu}${run.gpuBackend ? ` ${run.gpuBackend}` : ''}` : NO_GPU_LABEL;
export const runKey = (run: Pick<TestRunIndexEntry, 'suite' | 'version'>): string => `${run.suite}@${run.version}`;

/** `2026-10-20 14:03` in the viewer's time zone. */
export function formatRunDate(iso: string | undefined): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return 'unknown date';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Scenario counts of a run: failed checks or errors, validity issues (not hardware evidence), and the rest. */
export function runCounts(run: Pick<TestRunIndexEntry, 'cases'>): { valid: number; invalid: number; failed: number } {
  const counts = { valid: 0, invalid: 0, failed: 0 };
  for (const item of Object.values(run.cases)) {
    if (item.failed.length) counts.failed++;
    else if (item.invalid.length) counts.invalid++;
    else counts.valid++;
  }
  return counts;
}

export interface TestRunFilterOptions {
  readonly suites: readonly string[];
  readonly modes: readonly string[];
  readonly gpus: readonly string[];
}

export function runFilterOptions(runs: readonly TestRunIndexEntry[]): TestRunFilterOptions {
  const distinct = (values: string[]) => [...new Set(values)].sort();
  return { suites: distinct(runs.map((run) => run.suite)), modes: distinct(runs.map(runMode)), gpus: distinct(runs.map(runGpu)) };
}

export function filterRuns(runs: readonly TestRunIndexEntry[], filter: TestRunFilter): TestRunIndexEntry[] {
  return runs.filter((run) => (!filter.suite || run.suite === filter.suite) && (!filter.mode || runMode(run) === filter.mode) &&
    (!filter.gpu || runGpu(run) === filter.gpu));
}

/** Runs a run can be compared with: the same suite id and version in the same mode. Newest first, the run itself left out. */
export function baselineCandidates(runs: readonly TestRunIndexEntry[], run: TestRunIndexEntry): TestRunIndexEntry[] {
  return runs.filter((other) => other.file !== run.file && other.suite === run.suite && other.version === run.version && runMode(other) === runMode(run))
    .sort((a, b) => runTime(b) - runTime(a));
}

/** The latest matching run before this one. */
export function defaultBaseline(runs: readonly TestRunIndexEntry[], run: TestRunIndexEntry): TestRunIndexEntry | undefined {
  return baselineCandidates(runs, run).find((other) => runTime(other) < runTime(run));
}

export function splitMetricKey(key: string): { name: string; unit: string } {
  const match = /^(.*) \(([^()]*)\)$/.exec(key);
  return match ? { name: match[1], unit: match[2] } : { name: key, unit: '' };
}

export interface TestMetricChange {
  readonly median: number;
  readonly p95: number;
  readonly baseMedian: number;
  readonly baseP95: number;
  /** `(median - baseMedian) / baseMedian`; absent when the baseline median is 0. */
  readonly change?: number;
}

/**
 * Per scenario and metric, the change of the median from `baseline` to `run`, matched by scenario id and metric key.
 * A scenario or metric the baseline lacks has no entry.
 */
export function compareToBaseline(run: Pick<TestRunIndexEntry, 'cases'>, baseline: Pick<TestRunIndexEntry, 'cases'>):
  Record<string, Record<string, TestMetricChange>> {
  const out: Record<string, Record<string, TestMetricChange>> = {};
  for (const [id, item] of Object.entries(run.cases)) {
    const before = baseline.cases[id];
    if (!before) continue;
    for (const [key, metric] of Object.entries(item.metrics)) {
      const base = before.metrics[key];
      if (!base) continue;
      (out[id] ??= {})[key] = {
        median: metric.med, p95: metric.p95, baseMedian: base.med, baseP95: base.p95,
        ...(base.med !== 0 ? { change: (metric.med - base.med) / base.med } : {}),
      };
    }
  }
  return out;
}

export type TestChangeKind = 'none' | 'same' | 'better' | 'worse' | 'changed';

/** Times (`ms`, `µs`, `ns`) are lower-is-better; any other unit is only reported as changed. Inside the notice band it is the same. */
export function changeKind(change: number | undefined, unit: string): TestChangeKind {
  if (change === undefined || !Number.isFinite(change)) return 'none';
  if (Math.abs(change) < CHANGE_NOTICE) return 'same';
  if (unit !== 'ms' && unit !== 'µs' && unit !== 'ns') return 'changed';
  return change > 0 ? 'worse' : 'better';
}

export function formatChange(change: number | undefined): string {
  if (change === undefined || !Number.isFinite(change)) return 'n/a';
  return `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
}

export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const magnitude = Math.abs(value);
  return magnitude >= 100 ? value.toFixed(0) : magnitude >= 10 ? value.toFixed(1) : magnitude >= 1 ? value.toFixed(2) : value.toFixed(3);
}

/** Scenario ids of two runs side by side: `a`'s order, then those only `b` has. */
export function pairCases(a: Pick<TestRunIndexEntry, 'cases'>, b: Pick<TestRunIndexEntry, 'cases'>):
  { id: string; a?: TestRunIndexCase; b?: TestRunIndexCase }[] {
  const ids = [...new Set([...Object.keys(a.cases), ...Object.keys(b.cases)])];
  return ids.map((id) => ({ id, a: a.cases[id], b: b.cases[id] }));
}

/** Every metric key that appears in either run, in first-seen order. */
export function metricKeys(...runs: readonly Pick<TestRunIndexEntry, 'cases'>[]): string[] {
  const keys = new Set<string>();
  for (const run of runs) for (const item of Object.values(run.cases)) for (const key of Object.keys(item.metrics)) keys.add(key);
  return [...keys];
}

/** The frames of a case's looped thumbnail: the files of its first repetition (later repetitions look at the same thing). */
export function thumbnailFrames(files: readonly string[] | undefined): string[] {
  const repetition = (file: string) => Number(/-r(\d+)-\d+\.\w+$/.exec(file)?.[1] ?? 1);
  const first = Math.min(...(files ?? []).map(repetition));
  return (files ?? []).filter((file) => repetition(file) === first);
}

/** The receiver URL a result sink path or full URL points at, without a trailing slash. */
export const receiverBase = (receiver: string): string => receiver.trim().replace(/\/+$/, '');
export const indexUrl = (receiver: string, limit = 300): string => `${receiverBase(receiver)}/runs?limit=${limit}`;
export const resultUrl = (receiver: string, file: string): string => `${receiverBase(receiver)}/run?file=${encodeURIComponent(file)}`;
export const imageUrl = (receiver: string, file: string): string => `${receiverBase(receiver)}/image?file=${encodeURIComponent(file)}`;
