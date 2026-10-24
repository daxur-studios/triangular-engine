import { createSpanRecorder } from './test-spans';
import { describeJsEngine, describeTimer, jsEngineFamily } from './test-timer';
import { metric, timeMetric, waitFor } from './test-helpers';
import { iqrOutliers, measureCpuCase, scalingExponent } from './test-cpu-measure';

function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* spin */ }
}

describe('createSpanRecorder', () => {
  it('rejects empty, duplicate and reserved names', () => {
    expect(() => createSpanRecorder([])).toThrow();
    expect(() => createSpanRecorder(['a', 'a'])).toThrow();
    expect(() => createSpanRecorder(['total'])).toThrow();
    expect(() => createSpanRecorder(['a']).begin('b' as 'a')).toThrowError(/Unknown span/);
  });

  it('calibrates a small non-negative timer cost', () => {
    const cost = createSpanRecorder(['a']).timerCost;
    expect(cost.spanMs).toBeGreaterThanOrEqual(0);
    expect(cost.pairMs).toBeGreaterThanOrEqual(cost.spanMs);
    expect(cost.pairMs).toBeLessThan(0.05);
  });

  it('gives one metric per span plus unattributed and total, with shares', () => {
    const spans = createSpanRecorder(['fast', 'slow'], { unit: 'µs', timerCost: { spanMs: 0, pairMs: 0 } });
    for (let i = 0; i < 5; i++) {
      spans.beginRound();
      spans.time('fast', () => busy(1));
      spans.time('slow', () => busy(4));
      busy(1);
      spans.endRound();
    }
    const metrics = spans.metrics();
    expect(metrics.map((m) => m.name)).toEqual(['fast', 'slow', 'unattributed', 'total']);
    expect(metrics.every((m) => m.unit === 'µs' && m.group === 'spans' && m.samples.length === 5)).toBeTrue();
    const share = (name: string) => metrics.find((m) => m.name === name)!.share!;
    expect(share('total')).toBe(1);
    expect(share('slow')).toBeGreaterThan(share('fast'));
    expect(share('fast') + share('slow') + share('unattributed')).toBeCloseTo(1, 1);
    expect(share('unattributed')).toBeGreaterThan(0.05);
    expect(metrics[1].samples[0]).toBeGreaterThan(3500);
  });

  it('adds repeated spans in a round, divides batches by iterations and removes the timer cost', () => {
    const spans = createSpanRecorder(['a'], { timerCost: { spanMs: 0.5, pairMs: 0.5 } });
    spans.beginRound();
    for (let i = 0; i < 4; i++) spans.time('a', () => busy(1));
    spans.endRound(4);
    const [a, , total] = spans.metrics();
    // Four ~1 ms spans minus 4 * 0.5 ms of cost, over 4 iterations: about 0.5 ms each.
    expect(a.samples[0]).toBeGreaterThan(0.4);
    expect(a.samples[0]).toBeLessThan(0.8);
    expect(total.samples[0]).toBeGreaterThanOrEqual(a.samples[0]);
  });

  it('closes a span when the timed function throws, and grows past its capacity', () => {
    const spans = createSpanRecorder(['a'], { capacity: 2, timerCost: { spanMs: 0, pairMs: 0 } });
    spans.beginRound();
    expect(() => spans.time('a', () => { throw new Error('x'); })).toThrowError('x');
    spans.endRound();
    for (let i = 0; i < 5; i++) { spans.beginRound(); spans.time('a', () => 1); spans.endRound(); }
    expect(spans.rounds).toBe(6);
    expect(spans.metrics()[0].samples.length).toBe(6);
    spans.reset();
    expect(spans.rounds).toBe(0);
  });
});

describe('timer and engine description', () => {
  it('measures a positive timer step', () => {
    const timer = describeTimer(5);
    expect(timer.resolutionMs).toBeGreaterThan(0);
    expect(timer.source).toBe('performance.now');
  });

  it('names the engine family', () => {
    expect(jsEngineFamily('node 22.1.0 (v8 12.4)')).toBe('node');
    expect(jsEngineFamily(describeJsEngine())).toMatch(/^(chrome|firefox|safari|node|unknown)$/);
  });
});

describe('helpers', () => {
  it('builds metrics', () => {
    expect(metric('a', 'µs', 'src', [1], { optional: true })).toEqual({ name: 'a', unit: 'µs', source: 'src', samples: [1], optional: true });
    expect(timeMetric('t', 'src', [1]).unit).toBe('ms');
  });

  it('waitFor polls until true and rejects on abort', async () => {
    const controller = new AbortController();
    let n = 0;
    const context = { signal: controller.signal, wait: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 1))) };
    await waitFor(context, () => ++n >= 3);
    expect(n).toBe(3);
    controller.abort(new Error('stop'));
    await expectAsync(waitFor(context, () => false)).toBeRejectedWithError('stop');
  });
});

describe('cpu measurement', () => {
  it('calibrates a batch so a sample lasts at least the target, and returns raw samples', async () => {
    let sink = 0;
    const result = await measureCpuCase({ body: () => { sink += Math.sqrt(sink + 1); }, warmupIterations: 2, batchTargetMs: 1, minSamples: 8, maxSamples: 8 });
    expect(sink).toBeGreaterThan(0);
    expect(result.samples.length).toBe(8);
    expect(result.batch).toBeGreaterThan(1);
    expect(result.samples.every((s) => s > 0 && s < 0.1)).toBeTrue();
    expect(result.samples[0] * result.batch).toBeGreaterThan(0.5);
  });

  it('runs the warmup untimed and brackets every batch with the round hooks', async () => {
    let calls = 0;
    const rounds: number[] = [];
    await measureCpuCase({ body: () => { calls++; busy(0.3); }, warmupIterations: 5, minSamples: 3, maxSamples: 3, batchTargetMs: 1,
      round: { begin: () => undefined, end: (n) => rounds.push(n) } });
    expect(rounds.length).toBe(3);
    expect(calls).toBeGreaterThanOrEqual(5 + 3);
  });

  it('stops on abort between samples', async () => {
    const controller = new AbortController();
    let samples = 0;
    const run = measureCpuCase({ body: () => { if (++samples === 40) controller.abort(new Error('cancelled')); busy(0.2); }, minSamples: 1000, maxSamples: 1000, signal: controller.signal });
    await expectAsync(run).toBeRejectedWithError('cancelled');
  });

  it('flags IQR outliers without removing them', () => {
    const values = [10, 11, 10, 12, 11, 10, 11, 50, 10, 11];
    const fences = iqrOutliers(values);
    expect(fences.indices).toEqual([7]);
    expect(values.length).toBe(10);
    expect(iqrOutliers([]).indices).toEqual([]);
  });

  it('fits the scaling exponent', () => {
    expect(scalingExponent([{ n: 1, value: 2 }, { n: 10, value: 20 }, { n: 100, value: 200 }])).toBeCloseTo(1, 6);
    expect(scalingExponent([{ n: 1, value: 1 }, { n: 10, value: 100 }])).toBeCloseTo(2, 6);
    expect(scalingExponent([{ n: 5, value: 1 }])).toBeNull();
  });
});
