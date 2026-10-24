/** The best clock the platform has, in milliseconds. */
export const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface TimerDescription {
  /** The smallest step the clock was seen to take, in ms. Timings of a few steps are rounding noise. */
  readonly resolutionMs: number;
  readonly source: 'performance.now' | 'Date.now';
}

/**
 * Measures the clock's step by spinning until it changes (about 20 steps; under a millisecond with isolated pages or
 * Node, 0.1 ms in a normal browser tab, 1 ms for `Date.now`). Record it with the results so a reader can judge them.
 */
export function describeTimer(steps = 20): TimerDescription {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < steps; i++) {
    const start = nowMs();
    let next = nowMs();
    while (next === start) next = nowMs();
    smallest = Math.min(smallest, next - start);
  }
  return { resolutionMs: smallest, source: typeof performance !== 'undefined' ? 'performance.now' : 'Date.now' };
}

/**
 * `<family> <version>`: `node 22.1.0 (v8 12.4)`, `chrome 124.0`, `firefox 125.0`, `safari 17.4`. Stored in the run's
 * `environment.jsEngine` and in baselines, which are only compared within one family.
 */
export function describeJsEngine(): string {
  const proc = (globalThis as { process?: { versions?: Record<string, string> } }).process;
  if (proc?.versions?.['node']) return `node ${proc.versions['node']} (v8 ${proc.versions['v8'] ?? 'unknown'})`;
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
  const match = /(Firefox|Chrome|Chromium|Edg)\/([\d.]+)/.exec(ua);
  if (match) return `${match[1] === 'Firefox' ? 'firefox' : 'chrome'} ${match[2]}`;
  const safari = /Version\/([\d.]+).*Safari/.exec(ua);
  return safari ? `safari ${safari[1]}` : 'unknown';
}

/** The first word of `describeJsEngine()`; two engines of one family give comparable CPU timings. */
export const jsEngineFamily = (description: string): string => description.split(' ')[0] || 'unknown';
