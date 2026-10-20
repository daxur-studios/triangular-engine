import type {
  TestBaseline, TestBaselineStats, TestCaseResult, TestMetric, TestMode, TestPerformanceCheck, TestPerformanceStatistic,
  TestRunResult, TestSetting, TestSuite,
} from './test-contracts';
import { nearestRankPercentile } from './test-stats';

/** Allowed relative increase over a baseline before it can count as a regression. */
export const DEFAULT_MAX_REGRESSION = 0.1;
/** Allowed absolute increase (the metric's own unit; 0.05 ms) before it can count as a regression. */
export const DEFAULT_MIN_REGRESSION = 0.05;

const STATISTICS: readonly TestPerformanceStatistic[] = ['median', 'p95'];

export interface PerformanceAssessment<TSettings extends object> {
  readonly verdict: TestRunResult<TSettings>['performanceVerdict'];
  /** The same cases, with `performanceChecks` on those that have any. */
  readonly cases: readonly TestCaseResult<TSettings>[];
  readonly notes: readonly string[];
}

/**
 * Computes the performance verdict of a finished run from the suite's budgets and baseline.
 *
 * - A functional suite is `not-run`.
 * - A failed or cancelled run, or any case with a validity issue, is `inconclusive`. So is a budgeted (or baselined)
 *   metric with no summary, unless the case marks that metric `optional`: missing evidence is not a pass.
 * - No budget and no applicable baseline: `unassessed`. A baseline applies only when its `mode` equals the run's;
 *   otherwise it is skipped with a note.
 * - Otherwise `fail` if any check failed, else `pass`.
 *
 * Budgets: summary statistic at or below the limit. Baseline: the median and p95 of every metric in the baseline must be
 * at or below the larger of `base * (1 + maxRegression)` and `base + minRegression`, so only a change that is large
 * both relatively and absolutely fails. Improvements never fail. A run on another GPU adapter than the baseline gets a note.
 */
export function assessPerformance<TSettings extends object>(
  suite: TestSuite<TSettings>, mode: TestMode, cases: readonly TestCaseResult<TSettings>[],
  environment: Readonly<Record<string, TestSetting>>, runBroken: boolean,
): PerformanceAssessment<TSettings> {
  if (suite.purpose !== 'performance') return { verdict: 'not-run', cases, notes: [] };
  const notes: string[] = [];
  let baseline = suite.baseline;
  if (baseline && baseline.mode !== mode) {
    notes.push(`Baseline ${baseline.runId} was recorded in ${baseline.mode} mode and not compared with this ${mode} run`);
    baseline = undefined;
  }
  const gpu = environment['gpu.description'];
  if (baseline?.gpu && typeof gpu === 'string' && gpu !== baseline.gpu) {
    notes.push(`Baseline was recorded on ${baseline.gpu}; this run used ${gpu}`);
  }
  let missing = false;
  let any = false;
  let failed = false;
  const assessed = cases.map((item) => {
    if (item.status !== 'completed') return item;
    const checks: TestPerformanceCheck[] = [];
    const wanted = new Set<string>();
    for (const metric of Object.keys(item.scenario.budgets ?? {})) wanted.add(metric);
    for (const metric of Object.keys(baseline?.cases[item.scenario.id] ?? {})) wanted.add(metric);
    for (const name of wanted) {
      const metric = item.metrics.find((candidate) => candidate.name === name);
      if (!metric?.summary) {
        if (!metric?.optional) { missing = true; notes.push(`${item.scenario.id}: no summary for ${name}`); }
        continue;
      }
      checks.push(...metricChecks(name, metric, item.scenario.budgets?.[name], baseline?.cases[item.scenario.id]?.[name], baseline));
    }
    if (!checks.length) return item;
    any = true;
    if (checks.some((check) => !check.passed)) failed = true;
    return { ...item, performanceChecks: checks };
  });
  const broken = runBroken || cases.some((item) => item.validityIssues.length > 0);
  const verdict = broken || missing ? 'inconclusive' : !any ? 'unassessed' : failed ? 'fail' : 'pass';
  return { verdict, cases: assessed, notes: [...new Set(notes)] };
}

function metricChecks(
  name: string, metric: TestMetric, budget: { readonly p95?: number; readonly median?: number } | undefined,
  base: TestBaselineStats | undefined, baseline: TestBaseline | undefined,
): TestPerformanceCheck[] {
  const summary = metric.summary;
  if (!summary) return [];
  const checks: TestPerformanceCheck[] = [];
  for (const statistic of STATISTICS) {
    const limit = budget?.[statistic];
    if (limit !== undefined) {
      checks.push({ metric: name, statistic, kind: 'budget', limit, actual: summary[statistic], passed: summary[statistic] <= limit });
    }
    const value = base?.[statistic];
    if (value !== undefined && baseline) {
      const bound = Math.max(value * (1 + (baseline.maxRegression ?? DEFAULT_MAX_REGRESSION)),
        value + (baseline.minRegression ?? DEFAULT_MIN_REGRESSION));
      checks.push({ metric: name, statistic, kind: 'baseline', limit: bound, actual: summary[statistic], base: value, passed: summary[statistic] <= bound });
    }
  }
  return checks;
}

export interface BaselineFromRunOptions {
  /** Keep only these metric names (for example to leave out a noisy CPU timer). Default: every metric with a summary. */
  readonly metrics?: readonly string[];
}

/**
 * Turns a saved run into a committable baseline. Only completed cases without a validity issue count; repetitions of a
 * scenario are combined by their median. Numbers are rounded to 4 decimals to keep the file small.
 * Check that the run was a quiet one on the intended GPU before committing the result.
 */
export function baselineFromRun(
  result: Pick<TestRunResult<object>, 'runId' | 'startedAt' | 'mode' | 'environment' | 'cases'>, options: BaselineFromRunOptions = {},
): TestBaseline {
  const samples = new Map<string, Map<string, { median: number[]; p95: number[] }>>();
  for (const item of result.cases) {
    if (item.status !== 'completed' || item.validityIssues.length) continue;
    for (const metric of item.metrics) {
      if (!metric.summary || (options.metrics && !options.metrics.includes(metric.name))) continue;
      const byMetric = samples.get(item.scenario.id) ?? new Map();
      const stats = byMetric.get(metric.name) ?? { median: [], p95: [] };
      stats.median.push(metric.summary.median);
      stats.p95.push(metric.summary.p95);
      byMetric.set(metric.name, stats);
      samples.set(item.scenario.id, byMetric);
    }
  }
  const middle = (values: number[]) => round(nearestRankPercentile([...values].sort((a, b) => a - b), 0.5));
  const cases: Record<string, Record<string, TestBaselineStats>> = {};
  for (const [scenarioId, byMetric] of samples) {
    cases[scenarioId] = {};
    for (const [name, stats] of byMetric) cases[scenarioId][name] = { median: middle(stats.median), p95: middle(stats.p95) };
  }
  const gpu = result.environment['gpu.description'];
  return {
    runId: result.runId, recordedAt: result.startedAt, mode: result.mode ?? 'standard',
    ...(typeof gpu === 'string' && gpu ? { gpu } : {}), cases,
  };
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
