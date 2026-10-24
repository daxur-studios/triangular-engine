import type { TestBaseline, TestCaseResult, TestMetric, TestRunAdapter, TestScenario, TestSuite } from './test-contracts';
import { assessPerformance, baselineFromRun } from './test-performance';
import { TestSession } from './test-session';
import { summarizeTestSamples } from './test-stats';

interface Settings { value: number }

const metric = (name: string, samples: number[], extra: Partial<TestMetric> = {}): TestMetric => {
  const summary = summarizeTestSamples(samples);
  return { name, unit: 'ms', source: 'test', samples, ...(summary ? { summary } : {}), ...extra };
};

const scenario = (id: string, budgets?: TestScenario<Settings>['budgets']): TestScenario<Settings> =>
  ({ id, label: id, durationMs: 1, settings: { value: 1 }, ...(budgets ? { budgets } : {}) });

const item = (sc: TestScenario<Settings>, metrics: TestMetric[], extra: Partial<TestCaseResult<Settings>> = {}): TestCaseResult<Settings> =>
  ({ scenario: sc, repetition: 1, status: 'completed', metrics, checks: [], validityIssues: [], limitations: [], ...extra });

// A flat series: median and p95 are both `value`.
const flat = (value: number) => Array.from({ length: 20 }, () => value);

const suite = (over: Partial<TestSuite<Settings>> = {}): TestSuite<Settings> =>
  ({ id: 's', version: 1, title: 'S', purpose: 'performance', scenarios: [scenario('a')], ...over });

const baseline = (over: Partial<TestBaseline> = {}): TestBaseline =>
  ({ runId: 'base', recordedAt: '2026-01-01T00:00:00Z', mode: 'standard', cases: { a: { gpu: { median: 1, p95: 1.2 } } }, ...over });

const assess = (s: TestSuite<Settings>, cases: TestCaseResult<Settings>[], mode: 'standard' | 'quick' = 'standard', broken = false) =>
  assessPerformance(s, mode, cases, { 'gpu.description': 'RTX' }, broken);

describe('assessPerformance', () => {
  const budgeted = scenario('a', { gpu: { p95: 2 } });

  it('is not-run for a functional suite', () => {
    expect(assess(suite({ purpose: 'functional' }), [item(budgeted, [metric('gpu', flat(1))])]).verdict).toBe('not-run');
  });

  it('is unassessed without budgets or baseline', () => {
    const result = assess(suite(), [item(scenario('a'), [metric('gpu', flat(1))])]);
    expect(result.verdict).toBe('unassessed');
    expect(result.cases[0].performanceChecks).toBeUndefined();
  });

  it('passes a budget when the statistic is at or below the limit, and records why', () => {
    const result = assess(suite({ scenarios: [budgeted] }), [item(budgeted, [metric('gpu', flat(2))])]);
    expect(result.verdict).toBe('pass');
    expect(result.cases[0].performanceChecks).toEqual([{ metric: 'gpu', statistic: 'p95', kind: 'budget', limit: 2, actual: 2, passed: true }]);
  });

  it('fails when a budget is exceeded', () => {
    const result = assess(suite({ scenarios: [budgeted] }), [item(budgeted, [metric('gpu', flat(2.5))])]);
    expect(result.verdict).toBe('fail');
    expect(result.cases[0].performanceChecks?.[0].passed).toBeFalse();
  });

  it('checks the median when the budget sets one', () => {
    const sc = scenario('a', { gpu: { median: 1 } });
    expect(assess(suite({ scenarios: [sc] }), [item(sc, [metric('gpu', flat(1.5))])]).verdict).toBe('fail');
  });

  it('fails a baseline regression only beyond both the relative and the absolute bound', () => {
    const s = suite({ baseline: baseline() });
    const sc = s.scenarios[0];
    // Bounds: median max(1.1, 1.05) = 1.1; p95 max(1.32, 1.25) = 1.32.
    const fail = assess(s, [item(sc, [metric('gpu', flat(1.5))])]);
    expect(fail.verdict).toBe('fail');
    expect(fail.cases[0].performanceChecks?.map((c) => [c.statistic, c.kind, c.passed, c.base])).toEqual([['median', 'baseline', false, 1], ['p95', 'baseline', false, 1.2]]);
    expect(assess(s, [item(sc, [metric('gpu', flat(1.1))])]).verdict).toBe('pass');
  });

  it('treats a change within the absolute slack as noise even when the relative change is large', () => {
    const s = suite({ baseline: baseline({ cases: { a: { gpu: { median: 0.05, p95: 0.05 } } } }) });
    // +80 % but only 0.04 ms above the base: inside the 0.05 ms default slack.
    expect(assess(s, [item(s.scenarios[0], [metric('gpu', flat(0.09))])]).verdict).toBe('pass');
    // Own tolerances: 0 ms slack makes the same change a failure.
    const strict = suite({ baseline: baseline({ cases: { a: { gpu: { median: 0.05, p95: 0.05 } } }, minRegression: 0 }) });
    expect(assess(strict, [item(strict.scenarios[0], [metric('gpu', flat(0.09))])]).verdict).toBe('fail');
  });

  it('never fails an improvement', () => {
    const s = suite({ baseline: baseline() });
    expect(assess(s, [item(s.scenarios[0], [metric('gpu', flat(0.2))])]).verdict).toBe('pass');
  });

  it('skips a baseline of another mode with a note', () => {
    const s = suite({ baseline: baseline() });
    const result = assess(s, [item(s.scenarios[0], [metric('gpu', flat(9))])], 'quick');
    expect(result.verdict).toBe('unassessed');
    expect(result.notes.join()).toContain('standard mode');
  });

  it('still applies budgets when the baseline is skipped', () => {
    const sc = scenario('a', { gpu: { p95: 2 } });
    const s = suite({ scenarios: [sc], baseline: baseline() });
    expect(assess(s, [item(sc, [metric('gpu', flat(1))])], 'quick').verdict).toBe('pass');
  });

  it('notes a baseline from another adapter without skipping it', () => {
    const s = suite({ baseline: baseline({ gpu: 'Other GPU' }) });
    const result = assess(s, [item(s.scenarios[0], [metric('gpu', flat(1))])]);
    expect(result.verdict).toBe('pass');
    expect(result.notes.join()).toContain('Other GPU');
  });

  it('ignores scenarios and metrics that the baseline does not list', () => {
    const s = suite({ baseline: baseline(), scenarios: [scenario('a'), scenario('b')] });
    const result = assess(s, [item(s.scenarios[1], [metric('gpu', flat(99))]), item(s.scenarios[0], [metric('gpu', flat(1)), metric('other', flat(99))])]);
    expect(result.verdict).toBe('pass');
  });

  it('is inconclusive when a case has a validity issue, even if a check failed', () => {
    const result = assess(suite({ scenarios: [budgeted] }), [item(budgeted, [metric('gpu', flat(9))], { validityIssues: ['Page was not focused'] })]);
    expect(result.verdict).toBe('inconclusive');
    expect(result.cases[0].performanceChecks?.[0].passed).toBeFalse();
  });

  it('is inconclusive for a failed or cancelled run', () => {
    expect(assess(suite({ scenarios: [budgeted] }), [item(budgeted, [metric('gpu', flat(1))])], 'standard', true).verdict).toBe('inconclusive');
  });

  it('is inconclusive when a budgeted metric has no evidence, unless it is optional', () => {
    const s = suite({ scenarios: [budgeted] });
    expect(assess(s, [item(budgeted, [metric('gpu', [], { unavailableReason: 'no timer' })])]).verdict).toBe('inconclusive');
    expect(assess(s, [item(budgeted, [])]).verdict).toBe('inconclusive');
    const optional = assess(s, [item(budgeted, [metric('gpu', [], { optional: true, unavailableReason: 'no timer' })])]);
    expect(optional.verdict).toBe('unassessed');
  });

  it('keeps one failing repetition as a fail', () => {
    const s = suite({ scenarios: [budgeted] });
    expect(assess(s, [item(budgeted, [metric('gpu', flat(1))]), item(budgeted, [metric('gpu', flat(3))])]).verdict).toBe('fail');
  });
});

describe('baselineFromRun', () => {
  const a = scenario('a');
  const run = (cases: TestCaseResult<Settings>[]) => ({
    runId: 'r1', startedAt: '2026-02-02T00:00:00Z', mode: undefined, environment: { 'gpu.description': 'RTX' }, cases,
  });

  it('records median and p95 per scenario and metric, with mode, run and adapter', () => {
    const result = baselineFromRun(run([item(a, [metric('gpu', flat(1.23456)), metric('empty', [], { optional: true })])]));
    expect(result).toEqual({ runId: 'r1', recordedAt: '2026-02-02T00:00:00Z', mode: 'standard', gpu: 'RTX', cases: { a: { gpu: { median: 1.2346, p95: 1.2346 } } } });
  });

  it('skips invalid and failed cases and combines repetitions by their median', () => {
    const result = baselineFromRun(run([
      item(a, [metric('gpu', flat(1))]), item(a, [metric('gpu', flat(2))]), item(a, [metric('gpu', flat(3))]),
      item(a, [metric('gpu', flat(50))], { validityIssues: ['x'] }), item(a, [], { status: 'failed' }),
    ]));
    expect(result.cases['a']['gpu']).toEqual({ median: 2, p95: 2 });
  });

  it('can keep only the named metrics, and what it makes is usable as a suite baseline', () => {
    const result = baselineFromRun(run([item(a, [metric('gpu', flat(1)), metric('cpu', flat(1))])]), { metrics: ['gpu'] });
    expect(Object.keys(result.cases['a'])).toEqual(['gpu']);
    const s = suite({ baseline: result });
    expect(assess(s, [item(a, [metric('gpu', flat(1))])]).verdict).toBe('pass');
  });
});

describe('TestSession performance verdict', () => {
  const adapter = (samples: number[]): TestRunAdapter<Settings, number> => ({
    capture: () => 0, apply: () => {}, ready: async () => {}, restore: () => {},
    measure: async () => ({ metrics: [{ name: 'gpu', unit: 'ms', source: 't', samples }] }),
    environment: () => ({ 'gpu.vendor': 'nvidia', 'gpu.description': 'RTX' }),
  });
  const sc = scenario('a', { gpu: { p95: 2 } });
  const run = (samples: number[], profile: 'visible-browser' | 'headless-hardware' = 'visible-browser') =>
    new TestSession<Settings, number>().run(suite({ scenarios: [sc], expectedGpuVendor: 'nvidia' }), adapter(samples), { repetitions: 1, profile });

  beforeEach(() => {
    spyOn(document, 'hasFocus').and.returnValue(true);
    spyOnProperty(document, 'visibilityState').and.returnValue('visible');
  });

  it('computes pass and fail from the budget', async () => {
    const pass = await run(flat(1));
    expect(pass.performanceVerdict).toBe('pass');
    expect(pass.cases[0].performanceChecks?.length).toBe(1);
    expect((await run(flat(3))).performanceVerdict).toBe('fail');
  });

  it('stays inconclusive for an unverified headless profile', async () => {
    expect((await run(flat(1), 'headless-hardware')).performanceVerdict).toBe('inconclusive');
  });
});

describe('baseline tolerances and engines', () => {
  const us = (value: number) => metric('t', Array.from({ length: 20 }, () => value), { unit: 'µs' });
  const base = (over: Partial<TestBaseline> = {}) => baseline({ cases: { a: { t: { median: 10, p95: 10 } } }, ...over });
  const check = (b: TestBaseline, value: number, env: Record<string, string> = {}) =>
    assessPerformance(suite({ baseline: b }), 'standard', [item(scenario('a'), [us(value)])], env, false);

  it('judges a non-ms unit by the relative bound alone by default', () => {
    expect(check(base(), 10.9).verdict).toBe('pass');
    expect(check(base(), 11.5).verdict).toBe('fail');
  });

  it('uses a per-metric rel and abs over the baseline-wide values', () => {
    expect(check(base({ tolerances: { t: { rel: 0.5 } } }), 14).verdict).toBe('pass');
    expect(check(base({ tolerances: { t: { rel: 0, abs: 3 } } }), 12.5).verdict).toBe('pass');
    expect(check(base({ tolerances: { t: { rel: 0, abs: 3 } } }), 13.5).verdict).toBe('fail');
    expect(check(base({ maxRegression: 0.5, tolerances: { other: { rel: 0 } } }), 14).verdict).toBe('pass');
  });

  it('keeps the 0.05 ms floor for ms metrics', () => {
    const ms = assessPerformance(suite({ baseline: baseline({ cases: { a: { gpu: { median: 0.01, p95: 0.01 } } } }) }), 'standard',
      [item(scenario('a'), [metric('gpu', flat(0.04))])], {}, false);
    expect(ms.verdict).toBe('pass');
  });

  it('refuses a baseline from another engine family, with a note', () => {
    const result = check(base({ jsEngine: 'node 22.1.0 (v8 12.4)' }), 100, { jsEngine: 'chrome 130.0' });
    expect(result.verdict).toBe('unassessed');
    expect(result.notes.join()).toContain('not compared');
    expect(check(base({ jsEngine: 'chrome 129.0' }), 100, { jsEngine: 'chrome 130.0' }).verdict).toBe('fail');
  });

  it('records engine and tolerances in a baseline made from a run', () => {
    const made = baselineFromRun({ runId: 'r', startedAt: 'x', mode: 'standard', environment: { jsEngine: 'chrome 130.0' },
      cases: [item(scenario('a'), [us(10)])] }, { tolerances: { t: { rel: 0.2 } } });
    expect(made.jsEngine).toBe('chrome 130.0');
    expect(made.tolerances).toEqual({ t: { rel: 0.2 } });
  });
});
