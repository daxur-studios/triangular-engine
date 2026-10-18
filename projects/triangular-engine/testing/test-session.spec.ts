import { TestSession, waitForTest } from './test-session';
import type { TestRunAdapter, TestSuite } from './test-contracts';

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
