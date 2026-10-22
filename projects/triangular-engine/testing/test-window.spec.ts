import type { TestSettleSeries } from './test-contracts';
import {
  modeActionMs, modeWarmupMs, modeWindowMs, QUICK_MIN_WINDOW_MS, QUICK_WARMUP_MS, QUICK_WINDOW_MS, runMeasureWindow, seriesDrift, seriesSettled,
  SOAK_WINDOW_MS,
} from './test-window';

/** A fake clock: `wait` advances it, and each tick appends one sample per series from `next`. */
function clock(next: (t: number) => number) {
  let t = 0;
  const samples: number[] = [];
  return {
    samples,
    now: () => t,
    wait: async (ms: number) => { for (let i = 0; i < ms; i += 10) { t += 10; samples.push(next(t)); } },
  };
}

describe('test measurement window', () => {
  it('cuts warmup in quick mode and stretches the window in soak mode', () => {
    expect(modeWarmupMs({ warmupMs: 1500 }, 'quick')).toBe(QUICK_WARMUP_MS);
    expect(modeWarmupMs({ warmupMs: 100 }, 'quick')).toBe(100);
    expect(modeWarmupMs({ warmupMs: 1500 }, 'standard')).toBe(1500);
    expect(modeWarmupMs({}, 'soak')).toBe(0);
    expect(modeWindowMs({ durationMs: 5000 }, 'standard')).toBe(5000);
    expect(modeWindowMs({ durationMs: 5000 }, 'soak')).toBe(SOAK_WINDOW_MS);
  });

  it('calls a series settled when its halves agree, within tolerance or the timer step', () => {
    expect(seriesSettled(Array(100).fill(1))).toBeTrue();
    expect(seriesSettled(Array(10).fill(1))).toBeFalse();
    expect(seriesSettled([...Array(50).fill(1), ...Array(50).fill(2)])).toBeFalse();
    // 0.3 vs 0.4 ms is one 0.1 ms timer step: not a real change.
    expect(seriesSettled([...Array(50).fill(0.3), ...Array(50).fill(0.4)], 0.1)).toBeTrue();
    expect(seriesSettled([...Array(100).fill(1), NaN])).toBeTrue();
  });

  it('measures drift from the first to the last quarter', () => {
    expect(seriesDrift([1, 1, 1, 1, 1, 1, 1, 1])).toBe(0);
    expect(seriesDrift([1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1])).toBeCloseTo(0.1, 6);
    expect(seriesDrift([1, 2, 3])).toBeNull();
    expect(seriesDrift([0, 0, 1, 1, 1, 1, 1, 1])).toBeNull();
  });

  it('stops a quick window once every series settles, not before the minimum', async () => {
    const fake = clock(() => 1);
    const series: TestSettleSeries[] = [{ name: 'flat', samples: () => fake.samples }];
    const window = await runMeasureWindow({ durationMs: 5000 }, 'quick', series, fake.wait, fake.now);
    expect(window.stoppedBy).toBe('settled');
    expect(window.elapsedMs).toBeGreaterThanOrEqual(QUICK_MIN_WINDOW_MS);
    expect(window.elapsedMs).toBeLessThan(QUICK_MIN_WINDOW_MS + 200);
    expect(window.samples?.['flat']).toBe(fake.samples.length);
  });

  it('runs a quick window to its maximum when a series keeps changing', async () => {
    const fake = clock((t) => t);
    const window = await runMeasureWindow({ durationMs: 3000 }, 'quick', [{ name: 'ramp', samples: () => fake.samples }], fake.wait, fake.now);
    expect(window.stoppedBy).toBe('max');
    expect(window.elapsedMs).toBe(3000);
  });

  it('runs fixed windows without series, and reports drift only in soak mode', async () => {
    const quick = clock(() => 1);
    expect(await runMeasureWindow({ durationMs: 5000 }, 'quick', [], quick.wait, quick.now))
      .toEqual({ mode: 'quick', elapsedMs: QUICK_WINDOW_MS, stoppedBy: 'fixed' });
    const standard = clock(() => 1);
    const plain = await runMeasureWindow({ durationMs: 400 }, 'standard', [{ name: 's', samples: () => standard.samples }], standard.wait, standard.now);
    expect(plain.elapsedMs).toBe(400);
    expect(plain.drift).toBeUndefined();
    const soak = clock((t) => (t > SOAK_WINDOW_MS / 2 ? 1.2 : 1));
    const long = await runMeasureWindow({ durationMs: 400 }, 'soak', [{ name: 's', samples: () => soak.samples }], soak.wait, soak.now);
    expect(long.elapsedMs).toBe(SOAK_WINDOW_MS);
    expect(long.drift?.['s']).toBeCloseTo(0.2, 6);
  });

  it('gives a scenario its own quick length for windows and timed actions', async () => {
    const scenario = { durationMs: 8000, quickMs: 1500 };
    expect(modeActionMs(scenario, 'quick')).toBe(1500);
    expect(modeActionMs(scenario, 'standard')).toBe(8000);
    expect(modeActionMs(scenario, 'soak')).toBe(8000);
    expect(modeActionMs({ durationMs: 8000 }, 'quick')).toBe(8000);
    expect(modeWindowMs(scenario, 'quick')).toBe(1500);
    const unwatched = clock(() => 1);
    expect((await runMeasureWindow({ durationMs: 5000, quickMs: 700 }, 'quick', [], unwatched.wait, unwatched.now)).elapsedMs).toBe(700);
    const ramp = clock((t) => t);
    const capped = await runMeasureWindow(scenario, 'quick', [{ name: 'ramp', samples: () => ramp.samples }], ramp.wait, ramp.now);
    expect(capped).toEqual(jasmine.objectContaining({ stoppedBy: 'max', elapsedMs: 1500 }));
    const standard = clock(() => 1);
    expect((await runMeasureWindow(scenario, 'standard', [], standard.wait, standard.now)).elapsedMs).toBe(8000);
  });
});
