import { GpuTimer } from './gpu-timer';

describe('cloud GPU timer measurement boundaries', () => {
  it('discards a timestamp reply requested before reset and observes fresh samples once', async () => {
    const timer = new GpuTimer(1);
    let resolveRender!: (value: number) => void;
    const renderer = {
      initialized: true,
      resolveTimestampsAsync: (kind: string) => kind === 'render' ? new Promise<number>((resolve) => { resolveRender = resolve; }) : Promise.resolve(1),
    };
    const samples: number[] = [];
    const stop = timer.observeRender((sample) => samples.push(sample));
    timer.tick(renderer);
    timer.reset();
    resolveRender(99);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(samples).toEqual([]);
    expect(timer.render.last).toBeUndefined();
    timer.tick({ initialized: true, resolveTimestampsAsync: () => Promise.resolve(3) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(samples).toEqual([3]);
    stop();
  });
});
