import type { TestContext, TestRunAdapter, TestScenario } from './test-contracts';
import { nowMs } from './core/test-timer';

/** The part of an engine host the frame helpers use: anything with an `engine.beforeRender$` stream. */
export interface TestFrameHost {
  readonly engine: { readonly beforeRender$: { subscribe(next: () => void): { unsubscribe(): void } } };
}

/** Calls `onFrame` before every render with the wall time since the previous frame; returns the unsubscribe. */
export function onFrames(host: TestFrameHost, onFrame: (index: number, intervalMs: number) => void): () => void {
  let index = 0;
  let last = nowMs();
  const subscription = host.engine.beforeRender$.subscribe(() => {
    const now = nowMs();
    onFrame(index++, now - last);
    last = now;
  });
  return () => subscription.unsubscribe();
}

/** Resolves after `count` more rendered frames, or rejects on abort. */
export async function waitRenderedFrames(
  host: TestFrameHost, context: Pick<TestContext, 'signal' | 'wait'>, count: number,
): Promise<void> {
  let seen = 0;
  const stop = onFrames(host, () => seen++);
  try {
    while (seen < count) {
      context.signal.throwIfAborted();
      await context.wait(16);
    }
  } finally {
    stop();
  }
}

export interface TimedWindowOptions {
  /** Calls of `step` timed per frame; the sample is their mean. Default 1. */
  readonly evalsPerFrame?: number;
  /** Name of the settle series (default `evalUs`). */
  readonly series?: string;
  /** Timer step of the series in µs, for the quick-mode settle check (default 5). */
  readonly resolutionUs?: number;
}

export interface TimedWindowResult {
  /** Mean microseconds of `step` per rendered frame, one per frame after the first. */
  readonly samples: number[];
  readonly frameMs: number[];
  readonly frames: number;
}

/**
 * Per-frame evaluation timer: each rendered frame runs `step(frameIndex)` `evalsPerFrame` times and records the mean
 * microseconds, plus the frame interval, while `context.measureWindow` decides how long the window is (quick mode
 * stops once the series settles). The work runs inside the engine's frame, so the numbers include what it adds to a
 * real frame; they are not GPU timings. For CPU work with no frame loop use `cpuBench`.
 */
export async function timedWindow(
  host: TestFrameHost, scenario: TestScenario<object>, context: Pick<TestContext, 'measureWindow'>,
  step: (frame: number) => void, options: TimedWindowOptions = {},
): Promise<TimedWindowResult> {
  const evals = Math.max(1, options.evalsPerFrame ?? 1);
  const samples: number[] = [];
  const frameMs: number[] = [];
  let frames = 0;
  const stop = onFrames(host, (index, intervalMs) => {
    frames = index + 1;
    if (index === 0) return;
    frameMs.push(intervalMs);
    const start = nowMs();
    for (let i = 0; i < evals; i++) step(index);
    samples.push(((nowMs() - start) * 1000) / evals);
  });
  try {
    await context.measureWindow(scenario, [{ name: options.series ?? 'evalUs', samples: () => samples, resolution: options.resolutionUs ?? 5 }]);
  } finally {
    stop();
  }
  return { samples, frameMs, frames };
}

/**
 * Builds scenarios from shared defaults: `make(id, label, settingsOverrides?, extra?)`. The defaults carry the settings
 * every scenario starts from plus any other scenario field (`durationMs`, `warmupMs`, `quickMs`, `budgets`).
 */
export function scenarioFactory<TSettings extends object>(
  defaults: Omit<TestScenario<TSettings>, 'id' | 'label'>,
): (id: string, label: string, settings?: Partial<TSettings>, extra?: Partial<Omit<TestScenario<TSettings>, 'id' | 'label' | 'settings'>>) => TestScenario<TSettings> {
  return (id, label, settings = {}, extra = {}) => ({ ...defaults, ...extra, id, label, settings: { ...defaults.settings, ...settings } });
}

export interface SimpleAdapterParts<TSettings extends object, TSnapshot = undefined> {
  measure: TestRunAdapter<TSettings, TSnapshot>['measure'];
  apply?: TestRunAdapter<TSettings, TSnapshot>['apply'];
  capture?: TestRunAdapter<TSettings, TSnapshot>['capture'];
  restore?: TestRunAdapter<TSettings, TSnapshot>['restore'];
  ready?: TestRunAdapter<TSettings, TSnapshot>['ready'];
  environment?: TestRunAdapter<TSettings, TSnapshot>['environment'];
  thumbnail?: TestRunAdapter<TSettings, TSnapshot>['thumbnail'];
  /** Default true: `measure` times its window with `context.measureWindow`. */
  windowModes?: boolean;
  /** Pure CPU adapter: see `TestRunAdapter.cpuOnly`. */
  cpuOnly?: boolean;
}

/** An adapter from `measure` alone; capture, apply, ready and restore default to doing nothing. */
export function simpleAdapter<TSettings extends object, TSnapshot = undefined>(
  parts: SimpleAdapterParts<TSettings, TSnapshot>,
): TestRunAdapter<TSettings, TSnapshot> {
  return {
    capture: parts.capture ?? (() => undefined as TSnapshot),
    apply: parts.apply ?? (() => undefined),
    ready: parts.ready ?? (async () => undefined),
    measure: parts.measure,
    restore: parts.restore ?? (() => undefined),
    windowModes: parts.windowModes ?? true,
    ...(parts.environment ? { environment: parts.environment } : {}),
    ...(parts.thumbnail ? { thumbnail: parts.thumbnail } : {}),
    ...(parts.cpuOnly ? { cpuOnly: true } : {}),
  };
}
