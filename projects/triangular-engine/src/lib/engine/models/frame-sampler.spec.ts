import { FrameSampler, summarizeFrameSamples } from './frame-sampler';

describe('FrameSampler', () => {
  const frames = (count: number, cpu: number) => Array.from({ length: count }, () => cpu);

  it('records nothing outside a window', () => {
    const sampler = new FrameSampler();
    sampler.recordFrame(5, 16);
    sampler.recordGpu(3);

    expect(sampler.isActive).toBeFalse();
    sampler.start();
    expect(sampler.stop().frames).toBe(0);
  });

  it('summarises medians and reports ok for a steady window', () => {
    const sampler = new FrameSampler();
    sampler.start();
    for (let i = 0; i < 100; i++) sampler.recordFrame(4, 6.06);
    const summary = sampler.stop();

    expect(summary.frames).toBe(100);
    expect(summary.cpuMedianMs).toBe(4);
    expect(summary.wallMedianMs).toBeCloseTo(6.06, 5);
    expect(summary.gpuMedianMs).toBeNull();
    expect(summary.verdict).toBe('ok');
  });

  it('is inconclusive below 60 frames', () => {
    const summary = summarizeFrameSamples(frames(30, 4), frames(30, 6), []);

    expect(summary.verdict).toBe('inconclusive');
  });

  it('is noisy when the CPU p95 sits more than 15 % above the median', () => {
    const cpu = [...frames(90, 4), ...frames(10, 9)];
    const summary = summarizeFrameSamples(cpu, frames(100, 16), []);

    expect(summary.cpuP95Ms).toBe(9);
    expect(summary.verdict).toBe('noisy');
  });

  it('takes GPU median from recorded samples and ignores negative wall intervals', () => {
    const sampler = new FrameSampler();
    sampler.start();
    for (let i = 0; i < 70; i++) sampler.recordFrame(4, i === 0 ? -1 : 16);
    sampler.recordGpu(2);
    sampler.recordGpu(6);
    sampler.recordGpu(4);
    const summary = sampler.stop();

    expect(summary.wallMedianMs).toBe(16);
    expect(summary.gpuMedianMs).toBe(4);
    expect(summary.gpuSamples).toBe(3);
  });

  it('uses the average of the two middle values for an even count', () => {
    const summary = summarizeFrameSamples(frames(30, 2).concat(frames(30, 4)), frames(60, 16), []);

    expect(summary.cpuMedianMs).toBe(3);
  });

  it('uses nearest-rank for p95 at the boundary', () => {
    const cpu = [...frames(95, 1), ...frames(5, 9)];
    const summary = summarizeFrameSamples(cpu, frames(100, 16), []);

    expect(summary.cpuP95Ms).toBe(1);
  });

  it('is noisy when the median is zero but the tail is not', () => {
    const cpu = [...frames(90, 0), ...frames(10, 10)];
    const summary = summarizeFrameSamples(cpu, frames(100, 16), []);

    expect(summary.verdict).toBe('noisy');
  });

  it('is inconclusive when the page was throttled (median wall interval above 50 ms)', () => {
    const summary = summarizeFrameSamples(frames(100, 1), frames(100, 100), []);

    expect(summary.verdict).toBe('inconclusive');
    expect(summary.invalidReasons.length).toBe(1);
  });

  it('is inconclusive when the window was invalidated (for example hidden or unfocused)', () => {
    const sampler = new FrameSampler();
    sampler.start();
    for (let i = 0; i < 100; i++) sampler.recordFrame(1, 16);
    sampler.invalidate('hidden');
    sampler.invalidate('hidden');
    const summary = sampler.stop();

    expect(summary.invalidReasons).toEqual(['hidden']);
    expect(summary.verdict).toBe('inconclusive');
  });

  it('ignores invalidate outside a window', () => {
    const sampler = new FrameSampler();
    sampler.invalidate('hidden');
    sampler.start();
    for (let i = 0; i < 100; i++) sampler.recordFrame(1, 16);

    expect(sampler.stop().verdict).toBe('ok');
  });
});
