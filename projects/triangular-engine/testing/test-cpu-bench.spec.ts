import { cpuBench } from './test-cpu-bench';
import { simpleAdapter, scenarioFactory, timedWindow, onFrames, waitRenderedFrames } from './test-helpers';
import { CPU_ONLY_LIMITATION, TestSession } from './test-session';
import type { TestSuite } from './test-contracts';

describe('cpuBench', () => {
  const bench = () => {
    let torn = 0;
    const b = cpuBench<number[]>({
      counts: [100, 400],
      spans: ['sum', 'scale'],
      setup: (n) => Array.from({ length: n }, (_, i) => i),
      run: (data, n, spans) => {
        let total = 0;
        spans!.time('sum', () => { for (let i = 0; i < n; i++) total += data[i]; });
        spans!.time('scale', () => { for (let i = 0; i < n; i++) total += data[i] * 2; });
        if (total < 0) throw new Error('unreachable');
      },
      teardown: () => { torn++; },
      durationMs: 60, quickMs: 30, minSamples: 5, maxSamples: 20,
    });
    return { b, torn: () => torn };
  };

  it('rejects empty or non-positive counts', () => {
    expect(() => cpuBench({ counts: [], setup: () => 0, run: () => undefined })).toThrow();
    expect(() => cpuBench({ counts: [0], setup: () => 0, run: () => undefined })).toThrow();
  });

  it('runs headless as a CPU-evidence performance suite with a breakdown and scaling', async () => {
    const { b, torn } = bench();
    const suite = b.suite({ id: 'cpu', version: 1, title: 'CPU' });
    expect(suite.evidence).toBe('cpu');
    const result = await new TestSession<{ count: number }, undefined>().run(suite, b.adapter, { repetitions: 1, profile: 'headless-hardware', mode: 'quick' });
    expect(result.status).toBe('completed');
    expect(result.cases.every((c) => c.validityIssues.length === 0)).toBeTrue();
    expect(result.cases.every((c) => c.limitations.includes(CPU_ONLY_LIMITATION))).toBeTrue();
    expect(result.environment['evidence']).toBe('cpu-only');
    expect(result.environment['jsEngine']).toEqual(jasmine.any(String));
    const first = result.cases[0];
    expect(first.metrics.map((m) => m.name)).toEqual(['timeUs', 'usPerUnit', 'sum', 'scale', 'unattributed', 'total']);
    expect(first.metrics.find((m) => m.name === 'sum')!.share).toBeGreaterThan(0);
    expect(first.metrics.find((m) => m.name === 'timeUs')!.summary!.count).toBeGreaterThanOrEqual(5);
    expect(first.details!['outliers']).toEqual(jasmine.any(Number));
    expect(result.cases[1].details!['scalingExponent']).toEqual(jasmine.any(Number));
    expect(torn()).toBe(2);
    expect(result.performanceVerdict).toBe('unassessed');
  });

  it('keeps the GPU rules for a normal performance suite headless', async () => {
    const { b } = bench();
    const suite: TestSuite<{ count: number }> = { ...b.suite({ id: 'cpu', version: 1, title: 'CPU' }), evidence: 'gpu' };
    const adapter = { ...b.adapter, cpuOnly: false };
    const result = await new TestSession<{ count: number }, undefined>().run(suite, adapter, { repetitions: 1, profile: 'headless-hardware', mode: 'quick' });
    expect(result.status).toBe('inconclusive');
    expect(result.cases[0].validityIssues).toContain('Headless hardware/power profile was not independently verified');
  });

  it('stops promptly when cancelled', async () => {
    const b = cpuBench({ counts: [1], setup: () => 0, run: () => undefined, durationMs: 60_000, minSamples: 1, maxSamples: 10_000_000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('Run cancelled')), 50);
    const started = performance.now();
    const result = await new TestSession<{ count: number }, undefined>().run(b.suite({ id: 'c', version: 1, title: 'C' }), b.adapter,
      { repetitions: 1, profile: 'headless-hardware', mode: 'standard' }, undefined, controller.signal);
    expect(result.status).toBe('cancelled');
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('test helpers', () => {
  it('scenarioFactory merges defaults, settings and extras', () => {
    const make = scenarioFactory<{ a: number; b: number }>({ durationMs: 100, quickMs: 10, settings: { a: 1, b: 2 } });
    expect(make('x', 'X', { b: 5 }, { warmupMs: 7 })).toEqual({ id: 'x', label: 'X', durationMs: 100, quickMs: 10, warmupMs: 7, settings: { a: 1, b: 5 } });
  });

  it('simpleAdapter fills in the lifecycle', async () => {
    const adapter = simpleAdapter<{ v: number }>({ measure: async () => ({ metrics: [] }), cpuOnly: true });
    expect(adapter.windowModes).toBeTrue();
    expect(adapter.cpuOnly).toBeTrue();
    expect(await adapter.capture({} as never)).toBeUndefined();
  });

  it('onFrames, waitRenderedFrames and timedWindow follow a frame host', async () => {
    const listeners = new Set<() => void>();
    const host = { engine: { beforeRender$: { subscribe: (fn: () => void) => { listeners.add(fn); return { unsubscribe: () => listeners.delete(fn) }; } } } };
    const tick = setInterval(() => listeners.forEach((fn) => fn()), 2);
    try {
      const context = { signal: new AbortController().signal, wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
      await waitRenderedFrames(host, context, 3);
      expect(listeners.size).toBe(0);
      let steps = 0;
      const scenario = { id: 's', label: 's', durationMs: 30, settings: {} };
      const result = await timedWindow(host, scenario, { measureWindow: () => context.wait(40).then(() => ({}) as never) },
        () => { steps++; }, { evalsPerFrame: 2 });
      expect(result.samples.length).toBeGreaterThan(2);
      expect(steps).toBe(result.samples.length * 2);
      expect(result.frameMs.length).toBe(result.samples.length);
      const stop = onFrames(host, () => undefined);
      stop();
      expect(listeners.size).toBe(0);
    } finally { clearInterval(tick); }
  });
});
