import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PerfGitIdentity, PerfProfile } from './perf-environment';
import { coefficientOfVariation, median, round } from './perf-stats';

/**
 * The perf history is an append-only JSON Lines file: one `PerfHistoryEntry`
 * per scenario per recorded run. JSONL keeps appends cheap, keeps git diffs
 * to one added line per result, and lets `tools/perf-report.mjs` (or any
 * tool) stream it without a schema-aware parser.
 */
export const PERF_HISTORY_SCHEMA = 'perf-history-v1';

export type PerfScenarioParams = Record<string, number | string | boolean>;

export interface PerfProtocol {
  name: 'smoke' | 'reference';
  warmupMs: number;
  durationMs: number;
  repeats: number;
}

export interface PerfTolerance {
  /** Relative change (0.2 = 20%) that must be exceeded to count as a change. */
  relative: number;
  /** Absolute change in ms that must also be exceeded (guards tiny baselines). */
  absoluteMs: number;
}

export interface PerfHistoryEntry {
  schema: typeof PERF_HISTORY_SCHEMA;
  recordedAt: string;
  runId: string;
  git: PerfGitIdentity;
  engineVersion: string;
  profile: { id: string; label: string; softwareRendering: boolean };
  scenario: { id: string; version: number; params: PerfScenarioParams; paramsHash: string };
  protocol: PerfProtocol;
  /**
   * Flat metric map, e.g. `cpuFrameMs.p50`, `frameIntervalMs.p95`, `fps`,
   * `drawCalls`. Timings are milliseconds; lower is better unless the name
   * says otherwise (`fps`).
   */
  metrics: Record<string, number>;
  /** Per-repeat p50s used to judge measurement noise. */
  repeatP50: Record<string, number[]>;
  checks: { passed: boolean; failed: string[] };
  /** A run is invalid when the page was hidden, errors occurred, or samples were missing. */
  valid: boolean;
  invalidReasons: string[];
}

export type PerfMetricVerdict = 'regressed' | 'improved' | 'unchanged';

export interface PerfMetricComparison {
  metric: string;
  candidate: number;
  baseline: number;
  delta: number;
  relative: number;
  verdict: PerfMetricVerdict;
}

export interface PerfComparison {
  verdict: 'no-baseline' | 'unchanged' | 'improved' | 'regressed' | 'inconclusive';
  baselineEntries: number;
  baselineRange: { from: string; to: string } | null;
  metrics: PerfMetricComparison[];
  noise: { metric: string; cv: number } | null;
  summary: string;
}

/** Metrics compared by default. Custom scenario samples add `<name>.p50`. */
export const DEFAULT_GATED_METRICS = ['cpuFrameMs.p50', 'cpuFrameMs.p95', 'renderCpuMs.p50', 'frameIntervalMs.p95'] as const;

export const DEFAULT_TOLERANCE: Record<PerfProtocol['name'], PerfTolerance> = {
  smoke: { relative: 0.25, absoluteMs: 0.5 },
  reference: { relative: 0.1, absoluteMs: 0.25 },
};

/** Above this coefficient of variation between repeats, a regression is "inconclusive". */
export const NOISE_CV_LIMIT = 0.15;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function paramsHash(params: PerfScenarioParams): string {
  return createHash('sha256').update(canonicalJson(params)).digest('hex').slice(0, 12);
}

/** Entries share a key only when their timings are meaningfully comparable. */
export function comparisonKey(entry: Pick<PerfHistoryEntry, 'profile' | 'scenario' | 'protocol'>): string {
  return `${entry.profile.id}|${entry.scenario.id}@v${entry.scenario.version}|${entry.scenario.paramsHash}|${entry.protocol.name}`;
}

export function profileSummary(profile: PerfProfile): PerfHistoryEntry['profile'] {
  return { id: profile.id, label: profile.label, softwareRendering: profile.gpu.softwareRendering };
}

export interface ReadHistoryResult {
  entries: PerfHistoryEntry[];
  skippedLines: number;
}

export function readHistory(file: string): ReadHistoryResult {
  if (!fs.existsSync(file)) return { entries: [], skippedLines: 0 };
  const entries: PerfHistoryEntry[] = [];
  let skippedLines = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as PerfHistoryEntry;
      if (parsed.schema === PERF_HISTORY_SCHEMA) entries.push(parsed);
      else skippedLines++;
    } catch {
      skippedLines++;
    }
  }
  return { entries, skippedLines };
}

export function appendHistory(file: string, entry: PerfHistoryEntry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prefix = fs.existsSync(file) && !fs.readFileSync(file, 'utf8').endsWith('\n') && fs.statSync(file).size > 0 ? '\n' : '';
  fs.appendFileSync(file, `${prefix}${JSON.stringify(entry)}\n`);
}

/**
 * Compares a candidate against the median of the last `window` comparable,
 * valid, check-passing history entries. A metric regresses only when it is
 * worse by more than *both* the relative and absolute tolerance, so tiny
 * baselines cannot flap on sub-millisecond jitter.
 */
export function compareToHistory(
  candidate: PerfHistoryEntry,
  history: readonly PerfHistoryEntry[],
  options: { metrics?: readonly string[]; tolerance?: PerfTolerance; window?: number } = {},
): PerfComparison {
  const key = comparisonKey(candidate);
  const window = options.window ?? 5;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE[candidate.protocol.name];
  const baseline = history
    .filter((entry) => entry.runId !== candidate.runId && entry.valid && entry.checks.passed && comparisonKey(entry) === key)
    .slice(-window);

  const metricNames = options.metrics ?? [
    ...DEFAULT_GATED_METRICS,
    ...Object.keys(candidate.metrics).filter((name) => name.startsWith('custom.') && name.endsWith('.p50')),
  ];

  const noise = worstNoise(candidate);

  if (baseline.length === 0) {
    return {
      verdict: 'no-baseline',
      baselineEntries: 0,
      baselineRange: null,
      metrics: [],
      noise,
      summary: `${candidate.scenario.id}: no comparable history on profile ${candidate.profile.label}; recorded values become the first reference`,
    };
  }

  const metrics: PerfMetricComparison[] = [];
  for (const metric of metricNames) {
    const value = candidate.metrics[metric];
    const previous = baseline.map((entry) => entry.metrics[metric]).filter((entryValue): entryValue is number => Number.isFinite(entryValue));
    if (!Number.isFinite(value) || previous.length === 0) continue;
    const base = median(previous);
    const delta = value - base;
    const threshold = Math.max(tolerance.absoluteMs, Math.abs(base) * tolerance.relative);
    metrics.push({
      metric,
      candidate: round(value),
      baseline: round(base),
      delta: round(delta),
      relative: base === 0 ? 0 : round(delta / base, 4),
      verdict: delta > threshold ? 'regressed' : -delta > threshold ? 'improved' : 'unchanged',
    });
  }

  const regressed = metrics.filter((metric) => metric.verdict === 'regressed');
  const improved = metrics.filter((metric) => metric.verdict === 'improved');
  let verdict: PerfComparison['verdict'] = regressed.length ? 'regressed' : improved.length ? 'improved' : 'unchanged';
  if (verdict === 'regressed' && noise && noise.cv > NOISE_CV_LIMIT) verdict = 'inconclusive';

  const describe = (list: PerfMetricComparison[]) => list.map((metric) => `${metric.metric} ${formatSigned(metric.relative * 100)}% (${metric.baseline} → ${metric.candidate} ms)`).join(', ');
  const summary =
    verdict === 'regressed' ? `${candidate.scenario.id}: REGRESSED ${describe(regressed)}`
      : verdict === 'inconclusive' ? `${candidate.scenario.id}: possible regression but repeats are noisy (cv ${round(noise!.cv, 3)} on ${noise!.metric}): ${describe(regressed)}`
        : verdict === 'improved' ? `${candidate.scenario.id}: improved ${describe(improved)}`
          : `${candidate.scenario.id}: unchanged vs median of ${baseline.length} previous run(s)`;

  return {
    verdict,
    baselineEntries: baseline.length,
    baselineRange: { from: baseline[0].recordedAt, to: baseline[baseline.length - 1].recordedAt },
    metrics,
    noise,
    summary,
  };
}

function worstNoise(entry: PerfHistoryEntry): PerfComparison['noise'] {
  let worst: PerfComparison['noise'] = null;
  for (const [metric, values] of Object.entries(entry.repeatP50)) {
    const cv = coefficientOfVariation(values);
    if (!worst || cv > worst.cv) worst = { metric, cv: round(cv, 4) };
  }
  return worst;
}

function formatSigned(value: number): string {
  const rounded = round(value, 1);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
