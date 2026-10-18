import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import type { AtmosphereLabState, AtmosphereLabTestSettings } from './atmosphere-lab-tests';

/** The lab state a run changes, captured read-only and restorable as a unit. */
export interface AtmosphereLabSnapshot {
  readonly state: AtmosphereLabState;
  /** The page's own morph sweep and sun animation: both are switched off during a run. */
  readonly sweep: boolean;
  readonly animateSun: boolean;
}

export interface AtmosphereFrameSummary {
  readonly frames: number;
  readonly cpuMedianMs: number;
  readonly cpuP95Ms: number;
  readonly wallMedianMs: number;
  readonly wallP95Ms: number;
  readonly invalidReasons: readonly string[];
  readonly verdict: string;
}

/** What the lab page offers the adapter: its normal actions plus read-only probes. Implemented by the page. */
export interface AtmosphereLabTestHost {
  read(): AtmosphereLabSnapshot;
  /** Applies a scenario through the page's own setters. Synchronous; a size or preset change rebakes afterwards. */
  apply(settings: AtmosphereLabTestSettings): void;
  /** Hands the page a morph value to use from its next tick (replaces the page's own sweep while a run drives it). */
  setMorphFrame(morph: number): void;
  restore(snapshot: AtmosphereLabSnapshot): void;
  renderedFrames(): number;
  /** True while a size or preset change is still baking tables. */
  isBaking(): boolean;
  /** Whether the half-resolution masked pass is rendered and read in the current frame. */
  maskedPassActive(): boolean;
  /** First engine, window or console error since `resetErrors`, or ''. */
  errors(): string;
  resetErrors(): void;
  onBeforeRender(callback: () => void): () => void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  /** Starts GPU timestamp collection; returns a stop function. Samples arrive through `callback` in milliseconds. */
  observeGpu(callback: (milliseconds: number) => void): () => void;
  gpuTimestampsSupported(): boolean;
  isSampling(): boolean;
  startSampling(): void;
  stopSampling(): AtmosphereFrameSummary;
  environment(): Readonly<Record<string, TestSetting>>;
}

const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 400;
const SETTLE_FRAMES = 3;
const STALL_MS = 5_000;
const MIN_WINDOW_FRAMES = 60;
const MORPH_TOLERANCE = 1e-6;
const NUMBER_TOLERANCE = 1e-6;

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Equal time per leg between keyframes; exact keyframe values at the leg ends. */
export function sweepMorphAt(keys: readonly number[], fraction: number): { morph: number; leg: number } {
  const legs = keys.length - 1;
  const f = Math.max(0, Math.min(1, fraction));
  const leg = Math.min(legs - 1, Math.floor(f * legs));
  const local = f * legs - leg;
  return { leg, morph: keys[leg] + (keys[leg + 1] - keys[leg]) * easeInOutCubic(local) };
}

/** Reaching every keyframe in order, never jumping a leg: a sweep that stalls or skips is a defect, not a slow frame. */
export function sweepTraceProblems(keys: readonly number[], trace: readonly number[]): string[] {
  if (!trace.length) return ['no sweep frames recorded'];
  const problems: string[] = [];
  const peak = Math.max(...keys);
  const floor = Math.min(...keys);
  if (Math.max(...trace) < peak - 1e-9) problems.push(`peak ${Math.max(...trace).toFixed(4)} below ${peak}`);
  if (Math.min(...trace) > floor + 1e-9) problems.push(`minimum ${Math.min(...trace).toFixed(4)} above ${floor}`);
  const last = trace[trace.length - 1];
  if (Math.abs(last - keys[keys.length - 1]) > 1e-9) problems.push(`final ${last} is not ${keys[keys.length - 1]}`);
  let direction = 0;
  let turns = 0;
  for (let i = 1; i < trace.length; i++) {
    const step = Math.sign(trace[i] - trace[i - 1]);
    if (step !== 0 && step !== direction) { if (direction !== 0) turns++; direction = step; }
  }
  if (turns !== keys.length - 2) problems.push(`${turns} direction changes, expected ${keys.length - 2}`);
  return problems;
}

/** Compares the scenario's state fields with what the page reports; a mismatch means a setter did not take effect. */
export function stateMismatches(actual: AtmosphereLabState, settings: AtmosphereLabTestSettings): string[] {
  const out: string[] = [];
  const same = (a: number, b: number) => Math.abs(a - b) <= NUMBER_TOLERANCE * Math.max(1, Math.abs(b));
  if (!actual.bentOn) out.push('bent planet is off');
  for (const key of ['planetRadiusM', 'altitudeM', 'yawDeg', 'pitchDeg', 'sunElevationDeg', 'sunAzimuthDeg', 'exposure'] as const) {
    if (!same(actual[key], settings[key])) out.push(`${key}: expected ${settings[key]}, found ${actual[key]}`);
  }
  for (const key of ['preset', 'projection', 'skyPath', 'maskEnabled', 'dayNight'] as const) {
    if (actual[key] !== settings[key]) out.push(`${key}: expected ${String(settings[key])}, found ${String(actual[key])}`);
  }
  if (!same(actual.anchor[0], settings.anchor[0]) || !same(actual.anchor[1], settings.anchor[1])) {
    out.push(`anchor: expected ${settings.anchor.join(',')}, found ${actual.anchor.join(',')}`);
  }
  return out;
}

async function waitForFrames(host: AtmosphereLabTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

function runSweep(
  scenario: TestScenario<AtmosphereLabTestSettings>, context: TestContext, host: AtmosphereLabTestHost, trace: number[],
): Promise<void> {
  const keys = scenario.settings.morphKeys;
  return new Promise<void>((resolve, reject) => {
    let startedAt: number | undefined;
    let currentLeg = 0;
    let lastRenderAt = performance.now();
    let endReached = false;
    let framesAfterEnd = 0;
    let done = false;
    const cleanup = () => {
      offBefore(); offRender(); clearInterval(stall); context.signal.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown) => { if (done) return; done = true; cleanup(); reject(error); };
    const onAbort = () => fail(context.signal.reason);
    const offBefore = host.onBeforeRender(() => {
      if (done || endReached) return;
      const now = performance.now();
      startedAt ??= now;
      const fraction = Math.min(1, (now - startedAt) / scenario.durationMs);
      const { morph, leg } = sweepMorphAt(keys, fraction);
      // A slow frame must not step over a keyframe: the first frame past a leg's end renders exactly that keyframe.
      const legs = keys.length - 1;
      let value = morph;
      if (leg > currentLeg || (fraction >= 1 && currentLeg < legs - 1)) value = keys[++currentLeg];
      else if (fraction >= 1) { value = keys[legs]; endReached = true; }
      host.setMorphFrame(value);
      trace.push(value);
    });
    const offRender = host.onRenderComplete(() => {
      lastRenderAt = performance.now();
      // The final keyframe is consumed by the page on its next tick, so let two frames render before the check.
      if (endReached && !done && ++framesAfterEnd >= 2) { done = true; cleanup(); resolve(); }
    });
    const stall = setInterval(() => {
      if (performance.now() - lastRenderAt > STALL_MS) fail(new Error(`Rendering stalled for ${STALL_MS} ms during the sweep`));
    }, 500);
    if (context.signal.aborted) onAbort(); else context.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Game-owned adapter for the atmosphere lab's bent planet. All page knowledge sits behind {@link AtmosphereLabTestHost};
 * the shared runner only sees settings, observations and snapshots.
 */
export function createAtmosphereLabTestAdapter(
  host: AtmosphereLabTestHost,
): TestRunAdapter<AtmosphereLabTestSettings, AtmosphereLabSnapshot> {
  async function waitSettled(scenario: TestScenario<AtmosphereLabTestSettings>, context: TestContext): Promise<void> {
    const settings = scenario.settings;
    const began = performance.now();
    let settledFrames = 0;
    let settledSince: number | undefined;
    let lastFrame = host.renderedFrames();
    const firstFrame = lastFrame;
    while (true) {
      const error = host.errors();
      if (error) throw new Error(error);
      const frame = host.renderedFrames();
      const state = host.read().state;
      const ok = frame >= firstFrame + 2 && !host.isBaking() && stateMismatches(state, settings).length === 0 &&
        Math.abs(state.morph - settings.morphKeys[0]) <= MORPH_TOLERANCE;
      if (!ok) { settledFrames = 0; settledSince = undefined; }
      else if (frame > lastFrame) { settledFrames++; settledSince ??= performance.now(); }
      lastFrame = frame;
      if (ok && settledFrames >= SETTLE_FRAMES && performance.now() - (settledSince ?? Infinity) >= SETTLE_MS) return;
      if (performance.now() - began > READY_TIMEOUT_MS) {
        throw new Error(`Lab not settled after ${READY_TIMEOUT_MS / 1000} s: ${JSON.stringify({ baking: host.isBaking(), mismatches: stateMismatches(state, settings), morph: state.morph })}`);
      }
      await context.wait(16);
    }
  }

  return {
    capture: () => host.read(),
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => waitSettled(scenario, context),
    measure: async (scenario, context): Promise<TestObservation> => {
      const settings = scenario.settings;
      if (host.isSampling()) throw new Error('Another frame sampling window is already active');
      const intervals: number[] = [];
      const gpu: number[] = [];
      const trace: number[] = [];
      let frames = 0;
      let maskedFrames = 0;
      let previousAt: number | undefined;
      host.startSampling();
      const offGpu = host.observeGpu((ms) => gpu.push(ms));
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (host.maskedPassActive()) maskedFrames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
      });
      let summary: AtmosphereFrameSummary;
      try {
        if (settings.kind === 'sweep') await runSweep(scenario, context, host, trace);
        else await context.wait(scenario.durationMs);
        summary = host.stopSampling();
      } finally {
        offRender();
        offGpu();
        if (host.isSampling()) host.stopSampling();
      }
      const state = host.read().state;
      const environment = host.environment();
      const finalMorph = settings.morphKeys[settings.morphKeys.length - 1];
      const mismatches = stateMismatches(state, settings);
      const sweepProblems = settings.kind === 'sweep' ? sweepTraceProblems(settings.morphKeys, trace) : [];
      const morphReached = Math.abs(state.morph - finalMorph) <= MORPH_TOLERANCE && sweepProblems.length === 0;
      const error = host.errors();
      const checks: TestCheck[] = [
        { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'Morph reached its final state', passed: morphReached,
          detail: settings.kind === 'sweep' ? (sweepProblems.join('; ') || `${trace.length} animation steps, final ${state.morph}`) : `morph ${state.morph}` },
        { name: 'No engine, window or console error', passed: error === '', detail: error || undefined },
      ];
      if (settings.expectMaskedPass !== null) {
        const expected = settings.expectMaskedPass;
        const matched = expected ? maskedFrames === frames : maskedFrames === 0;
        checks.push({ name: 'Masked pass active as expected', passed: frames > 0 && matched,
          detail: `${maskedFrames} of ${frames} frames had the masked pass, expected ${expected ? 'all' : 'none'}` });
      }
      const software = environment['softwareRenderer'] === true;
      const frameMetric: TestMetric = {
        name: 'frameInterval', unit: 'ms', source: 'Deltas of engine renderComplete$ timestamps (performance.now); display-cadence quantized, not GPU time',
        samples: intervals, unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed in the window',
      };
      const gpuMetric: TestMetric = {
        name: 'gpuRender', unit: 'ms', optional: true,
        source: 'Renderer GPU timestamp query (render), read every few frames; covers every render call since the previous read, including the sky-view table and the masked pass',
        samples: gpu,
        unavailableReason: gpu.length ? undefined : host.gpuTimestampsSupported() ? 'No timestamp reading came back in the window' : 'This backend has no GPU timestamp query',
      };
      return {
        metrics: [frameMetric, gpuMetric],
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms,
          wallMedianMs: summary.wallMedianMs, wallP95Ms: summary.wallP95Ms, frameVerdict: summary.verdict,
          maskedPassFrames: maskedFrames, finalMorph: state.morph,
        },
        validityIssues: [
          ...summary.invalidReasons,
          ...(summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in measurement window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
        ],
        limitations: [
          'GPU time is a batched whole-render timestamp, not the cost of one pass; the masked pass is not separated from the table and the rest.',
          'The masked pass runs only above the air or near an open map edge, so cost differs by view; each scenario states its view.',
          'Appearance (rim glow, seams at the map edge, popping while morphing) is not judged by these checks and needs human review.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.restore(snapshot);
      await waitForFrames(host, 2, context);
    },
    environment: () => host.environment(),
  };
}
