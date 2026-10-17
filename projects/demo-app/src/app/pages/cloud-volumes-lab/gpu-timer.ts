/* eslint-disable @typescript-eslint/no-explicit-any */

/** A rolling average of GPU milliseconds, or `undefined` while no timestamp has come back. */
export interface GpuTimerReading {
  /** Latest sample, ms. */
  readonly last: number | undefined;
  /** Mean of the last `window` samples, ms. */
  readonly average: number | undefined;
}

/**
 * Reads the renderer's GPU timestamp queries every N frames (Plan 051, Phase 0). The renderer must be created
 * with `trackTimestamp: true`. `render` covers every render call since the last read, including the bake passes
 * (they are render calls too); `compute` covers compute dispatches. On a backend without timestamp queries
 * (often the WebGL2 fallback) both stay `undefined`; the page shows that as "n/a".
 *
 * Copied from the pattern inline in `/atmosphere-lab` so that page stays untouched.
 */
export class GpuTimer {
  private frame = 0;
  private pending = false;
  private readonly renderSamples: number[] = [];
  private readonly computeSamples: number[] = [];
  private renderLast: number | undefined;
  private computeLast: number | undefined;

  constructor(
    private readonly everyFrames = 20,
    private readonly window = 30,
  ) {}

  get render(): GpuTimerReading {
    return { last: this.renderLast, average: mean(this.renderSamples) };
  }

  get compute(): GpuTimerReading {
    return { last: this.computeLast, average: mean(this.computeSamples) };
  }

  /** Number of render samples collected since the last reset. */
  get sampleCount(): number {
    return this.renderSamples.length;
  }

  /** Forgets the rolling samples, e.g. after switching camera preset. */
  reset(): void {
    this.renderSamples.length = 0;
    this.computeSamples.length = 0;
    this.renderLast = undefined;
    this.computeLast = undefined;
  }

  /** Call once per frame. Returns true when a new reading landed. */
  tick(renderer: any, onReading?: () => void): void {
    if (!renderer?.initialized || !renderer.resolveTimestampsAsync) return;
    if (++this.frame % this.everyFrames !== 0 || this.pending) return;
    this.pending = true;
    const read = (type: 'render' | 'compute'): Promise<number | undefined> =>
      Promise.resolve(renderer.resolveTimestampsAsync(type))
        .then((ms: unknown) => (typeof ms === 'number' && ms > 0 ? ms : undefined))
        .catch(() => undefined);
    Promise.all([read('render'), read('compute')])
      .then(([render, compute]) => {
        this.renderLast = render;
        this.computeLast = compute;
        if (render !== undefined) push(this.renderSamples, render, this.window);
        if (compute !== undefined) push(this.computeSamples, compute, this.window);
        onReading?.();
      })
      .finally(() => (this.pending = false));
  }
}

function push(samples: number[], value: number, window: number): void {
  samples.push(value);
  if (samples.length > window) samples.shift();
}

function mean(samples: readonly number[]): number | undefined {
  return samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : undefined;
}
