import { nearestRankPercentile, summarizeTestSamples, TestSession, waitForTest } from './test-session';
import type { TestObservation, TestRunAdapter, TestSuite } from './test-contracts';

interface Settings { value: number }
const suite: TestSuite<Settings> = {
  id: 'reference', version: 1, title: 'Reference', purpose: 'functional',
  scenarios: [{ id: 'first', label: 'First', durationMs: 1, settings: { value: 7 } }],
};

describe('TestSession', () => {
  let state: number;
  let adapter: TestRunAdapter<Settings, number>;
  beforeEach(() => {
    state = 3;
    adapter = {
      capture: () => state,
      apply: (scenario) => { state = scenario.settings.value; },
      ready: async () => {},
      measure: async () => ({ metrics: [], checks: [{ name: 'Applied state', passed: state === 7 }] }),
      restore: (snapshot, context) => { expect(context.signal.aborted).toBeFalse(); state = snapshot; },
    };
  });

  it('repeats resolved inputs and restores the initial state without accepting visual evidence', async () => {
    const result = await new TestSession<Settings, number>().run({ ...suite, requiresVisualReview: true }, adapter,
      { repetitions: 2, profile: 'headless-hardware' });
    expect(result.status).toBe('completed');
    expect(result.cases.length).toBe(2);
    expect(result.automatedVerdict).toBe('pass');
    expect(result.performanceVerdict).toBe('not-run');
    expect(result.visualReview).toBe('pending');
    expect(state).toBe(3);
  });

  it('keeps a partial failure and restores after an action throws', async () => {
    adapter.apply = () => { state = 99; throw new Error('action failure'); };
    const result = await new TestSession<Settings, number>().run(suite, adapter, { repetitions: 1, profile: 'headless-hardware' });
    expect(result.status).toBe('failed');
    expect(result.cases[0].error).toContain('action failure');
    expect(state).toBe(3);
  });

  it('cancels an in-flight measurement and restores with a fresh signal', async () => {
    const cancel = new AbortController();
    adapter.measure = async (_, context) => { cancel.abort(); await context.wait(1000); return { metrics: [] }; };
    const result = await new TestSession<Settings, number>().run(suite, adapter,
      { repetitions: 1, profile: 'headless-hardware' }, undefined, cancel.signal);
    expect(result.status).toBe('cancelled');
    expect(result.cases[0].status).toBe('cancelled');
    expect(state).toBe(3);
  });

  it('bounds a hung readiness check, restores, and allows a later run', async () => {
    const session = new TestSession<Settings, number>();
    adapter.ready = () => new Promise<void>(() => {});
    const result = await session.run(suite, adapter, { repetitions: 1, profile: 'headless-hardware', timeoutMs: 10 });
    expect(result.status).toBe('failed');
    expect(result.errors.join()).toContain('timed out');
    expect(state).toBe(3);
    adapter.ready = async () => {};
    expect((await session.run(suite, adapter, { repetitions: 1, profile: 'headless-hardware' })).status).toBe('completed');
  });

  it('reports restoration failure even when checks passed', async () => {
    adapter.restore = () => { throw new Error('restore failure'); };
    const result = await new TestSession<Settings, number>().run(suite, adapter, { repetitions: 1, profile: 'headless-hardware' });
    expect(result.status).toBe('failed');
    expect(result.errors.join()).toContain('Restoration failed');
  });

  it('never treats missing metrics or an unverified headless environment as a performance pass', async () => {
    const result = await new TestSession<Settings, number>().run({ ...suite, purpose: 'performance' }, adapter,
      { repetitions: 1, profile: 'headless-hardware' });
    expect(result.status).toBe('inconclusive');
    expect(result.performanceVerdict).toBe('inconclusive');
    expect(result.cases[0].validityIssues.length).toBe(2);
  });

  it('passes the applied scenario to ready so adapters need not remember it', async () => {
    const seen: string[] = [];
    adapter.ready = async (context, scenario) => { seen.push(`${context.repetition}:${scenario.id}:${scenario.settings.value}`); };
    const multi = { ...suite, scenarios: [...suite.scenarios, { ...suite.scenarios[0], id: 'second', settings: { value: 8 } }] };
    adapter.measure = async () => ({ metrics: [] });
    await new TestSession<Settings, number>().run(multi, adapter, { repetitions: 2, profile: 'headless-hardware' });
    expect(seen).toEqual(['1:first:7', '1:second:8', '2:first:7', '2:second:8']);
  });

  it('requests visual review from the explicit flag or observer profile, independently of suite purpose', async () => {
    for (const purpose of ['functional', 'performance'] as const) {
      const normal = await new TestSession<Settings, number>().run({ ...suite, purpose }, adapter,
        { repetitions: 1, profile: 'headless-hardware' });
      expect(normal.visualReview).toBe('not-required');
      const explicit = await new TestSession<Settings, number>().run({ ...suite, purpose, requiresVisualReview: true }, adapter,
        { repetitions: 1, profile: 'headless-hardware' });
      expect(explicit.visualReview).toBe('pending');
      const observed = await new TestSession<Settings, number>().run({ ...suite, purpose, requiresVisualReview: false }, adapter,
        { repetitions: 1, profile: 'human-observed' });
      expect(observed.visualReview).toBe('pending');
    }
  });

  it('lists an unavailable optional metric without making the performance case inconclusive', async () => {
    const perf: TestSuite<Settings> = { ...suite, purpose: 'performance' };
    const withMetrics = (metrics: TestObservation['metrics']) => {
      adapter.measure = async () => ({ metrics, checks: [{ name: 'Applied state', passed: true }] });
    };
    withMetrics([{ name: 'interval', unit: 'ms', source: 's', samples: [16, 17] },
      { name: 'gpu', unit: 'ms', source: 'none', samples: [], unavailableReason: 'no timestamp query', optional: true }]);
    const ok = await new TestSession<Settings, number>().run(perf, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(ok.cases[0].validityIssues).not.toContain('Required metric samples unavailable or invalid');
    expect(ok.cases[0].metrics.map((metric) => metric.name)).toEqual(['interval', 'gpu']);

    withMetrics([{ name: 'gpu', unit: 'ms', source: 'none', samples: [], optional: true }]);
    const onlyOptional = await new TestSession<Settings, number>().run(perf, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(onlyOptional.cases[0].validityIssues).toContain('Required metric samples unavailable or invalid');

    withMetrics([{ name: 'interval', unit: 'ms', source: 's', samples: [] }]);
    const missing = await new TestSession<Settings, number>().run(perf, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(missing.cases[0].validityIssues).toContain('Required metric samples unavailable or invalid');

    withMetrics([{ name: 'interval', unit: 'ms', source: 's', samples: [16], }, { name: 'gpu', unit: 'ms', source: 'x', samples: [NaN], optional: true }]);
    const invalid = await new TestSession<Settings, number>().run(perf, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(invalid.cases[0].validityIssues).toContain('Required metric samples unavailable or invalid');
  });

  it('summarizes each metric with nearest-rank statistics over its finite samples', async () => {
    adapter.measure = async () => ({ metrics: [
      { name: 'interval', unit: 'ms', source: 's', samples: [5, 1, 4, 2, 3, NaN, 10, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
      { name: 'gpu', unit: 'ms', source: 'none', samples: [], optional: true },
    ] });
    const result = await new TestSession<Settings, number>().run(suite, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(result.cases[0].metrics[0].summary).toEqual({ count: 20, min: 1, median: 10, p95: 19, max: 20 });
    expect(result.cases[0].metrics[1].summary).toBeUndefined();
  });

  it('uses the nearest rank at the percentile boundaries', () => {
    expect(nearestRankPercentile([1, 2, 3, 4, 10], 0.95)).toBe(10);
    expect(nearestRankPercentile([1, 2, 3, 4, 10], 0.5)).toBe(3);
    expect(nearestRankPercentile([4], 0)).toBe(4);
    expect(nearestRankPercentile([], 0.5)).toBeNaN();
    expect(summarizeTestSamples([NaN, Infinity])).toBeUndefined();
  });

  it('records a visible-profile blur as invalid evidence', async () => {
    adapter.measure = async () => { window.dispatchEvent(new Event('blur')); return { metrics: [] }; };
    const result = await new TestSession<Settings, number>().run(suite, adapter, { repetitions: 1, profile: 'visible-browser' });
    expect(result.cases[0].validityIssues).toContain('Page lost focus');
    expect(result.status).toBe('inconclusive');
  });

  it('retains a snapshot of inputs when the caller edits its original suite', async () => {
    const mutable = structuredClone(suite);
    adapter.measure = async () => { (mutable.scenarios[0].settings as Settings).value = 99; return { metrics: [] }; };
    const result = await new TestSession<Settings, number>().run(mutable, adapter, { repetitions: 1, profile: 'headless-hardware' });
    expect(result.suite.scenarios[0].settings.value).toBe(7);
    expect(result.cases[0].scenario.settings.value).toBe(7);
  });

  it('retains a failed check once and stops instead of reporting later cases as passed', async () => {
    adapter.measure = async () => ({ metrics: [], checks: [{ name: 'Expected failure', passed: false }] });
    const result = await new TestSession<Settings, number>().run(suite, adapter, { repetitions: 3, profile: 'headless-hardware' });
    expect(result.status).toBe('failed');
    expect(result.cases.length).toBe(1);
    expect(result.cases[0].checks[0].passed).toBeFalse();
  });

  it('rejects simultaneous runs before they can capture or restore each other', async () => {
    const session = new TestSession<Settings, number>();
    let release!: () => void;
    adapter.ready = () => new Promise<void>((resolve) => { release = resolve; });
    const first = session.run(suite, adapter, { repetitions: 1, profile: 'headless-hardware' });
    await expectAsync(session.run(suite, adapter, { repetitions: 1, profile: 'headless-hardware' })).toBeRejectedWithError('A test is already running');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await first;
  });

  it('rejects an already aborted wait immediately', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expectAsync(waitForTest(1000, controller.signal)).toBeRejectedWithError('stopped');
  });
});
