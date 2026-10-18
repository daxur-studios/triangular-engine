import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import { MORPH_TEST_WORLD, type MorphTestSettings, type MorphTestVec3, type MorphWorldSettings } from './morph-streaming-tests';

/** Every piece of page state a scenario changes, captured read-only and restorable as a unit. */
export interface MorphPageSnapshot {
  readonly world: MorphWorldSettings;
  /** The page keeps one streamed-texture flag per colour mode; only the active one is a scenario setting. */
  readonly streamedTextureLodByMode: Readonly<Record<string, boolean>>;
  readonly morph: number;
  /** Debounced morph the LOD selector reads. */
  readonly lodMorph: number;
  readonly uniformMorph: number;
  readonly bookmark: string;
  /** Actual camera and orbit target, read from the live controls rather than the page's input signals. */
  readonly position: MorphTestVec3;
  readonly target: MorphTestVec3;
  readonly orbitUp: MorphTestVec3;
  readonly controls: { readonly enabled: boolean; readonly damping: boolean };
  readonly factionOverlay: boolean;
}

export interface MorphStreamingStatus {
  readonly patchesDesired: number;
  readonly patchesResident: number;
  readonly patchesQueued: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly tilesEnabled: boolean;
  readonly tilesResident: number;
  readonly tilesQueued: number;
  readonly tilesInFlight: number;
  readonly tilesCompleted: number;
}

export interface MorphFrameSummary {
  readonly frames: number;
  readonly cpuMedianMs: number;
  readonly cpuP95Ms: number;
  readonly wallMedianMs: number;
  readonly wallP95Ms: number;
  readonly invalidReasons: readonly string[];
  readonly verdict: string;
}

/** What the morph page offers the adapter: its normal actions plus read-only probes. Implemented by the page. */
export interface MorphTestHost {
  read(): MorphPageSnapshot;
  /** Applies world settings and controls through the page's own setters. Synchronous; streaming follows. */
  applyWorld(settings: MorphTestSettings): void;
  /** One animation step: morph uniform/signal and the camera pose, as the Animate button does per frame. */
  setMorphFrame(morph: number, position: MorphTestVec3, target: MorphTestVec3): void;
  /** Lets the LOD selector see the morph (the Animate button does this at the end of a leg). */
  commitMorph(morph: number): void;
  restore(snapshot: MorphPageSnapshot): void;
  renderedFrames(): number;
  streaming(): MorphStreamingStatus;
  /** First engine, worker or material error since `resetErrors`, or ''. */
  errors(): string;
  resetErrors(): void;
  onBeforeRender(callback: () => void): () => void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  isSampling(): boolean;
  startSampling(): void;
  stopSampling(): MorphFrameSummary;
  environment(): Readonly<Record<string, TestSetting>>;
}

const READY_TIMEOUT_MS = 90_000;
const SETTLE_MS = 400;
const SETTLE_FRAMES = 3;
const STALL_MS = 5_000;
const MIN_WINDOW_FRAMES = 60;
/** OrbitControls clamps the polar angle to 0.01 degrees, so a straight-down pose is moved a few hundred metres. */
const POSE_TOLERANCE = 0.002;

function lerp3(a: MorphTestVec3, b: MorphTestVec3, t: number): MorphTestVec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function distance(a: MorphTestVec3, b: MorphTestVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The camera sits on the line between the two explicit poses at the current morph. */
export function expectedMorphPose(settings: MorphTestSettings, morph: number): MorphTestVec3 {
  return lerp3(settings.cameraAtMorph0, settings.cameraAtMorph1, morph);
}

/** The page's Animate easing, so a sweep moves like the button does. */
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

/** Compares only the world fields; a scenario's camera and morph keys are checked separately. */
export function worldMismatches(actual: MorphWorldSettings, expected: MorphWorldSettings): string[] {
  const out: string[] = [];
  for (const key of Object.keys(MORPH_TEST_WORLD) as (keyof MorphWorldSettings)[]) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${String(expected[key])}, found ${String(actual[key])}`);
  }
  return out;
}

async function waitForFrames(host: MorphTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

/** Streaming is settled when meshes and (if enabled) texture tiles are resident and no work is queued. */
export function streamingSettled(status: MorphStreamingStatus): boolean {
  return status.patchesDesired > 0 && status.patchesResident > 0 && status.patchesQueued === 0 &&
    (!status.tilesEnabled || (status.tilesQueued === 0 && status.tilesInFlight === 0 && status.tilesResident > 0));
}

function runSweep(
  scenario: TestScenario<MorphTestSettings>, context: TestContext, host: MorphTestHost, trace: number[],
): Promise<void> {
  const settings = scenario.settings;
  const keys = settings.morphKeys;
  return new Promise<void>((resolve, reject) => {
    let startedAt: number | undefined;
    let currentLeg = 0;
    let lastRenderAt = performance.now();
    let endReached = false;
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
      // Slow frames must not step over a keyframe: the first frame past a leg's end renders exactly that
      // keyframe (and lets the LOD selector see it, as the Animate button does), then the next leg continues.
      const legs = keys.length - 1;
      let snapped = morph;
      if (leg > currentLeg || (fraction >= 1 && currentLeg < legs - 1)) {
        snapped = keys[++currentLeg];
        host.commitMorph(snapped);
      } else if (fraction >= 1) {
        snapped = keys[legs];
        endReached = true;
        host.commitMorph(snapped);
      }
      host.setMorphFrame(snapped, expectedMorphPose(settings, snapped), settings.cameraTarget);
      trace.push(snapped);
    });
    const offRender = host.onRenderComplete(() => {
      lastRenderAt = performance.now();
      if (endReached && !done) { done = true; cleanup(); resolve(); }
    });
    const stall = setInterval(() => {
      if (performance.now() - lastRenderAt > STALL_MS) fail(new Error(`Rendering stalled for ${STALL_MS} ms during the sweep`));
    }, 500);
    if (context.signal.aborted) onAbort(); else context.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Per-leg monotonic and reaching every keyframe: a sweep that jumps or never arrives is a defect, not a slow frame. */
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

/**
 * Game-owned adapter for the morph streaming page. All page knowledge sits behind {@link MorphTestHost};
 * the shared runner only sees settings, observations and snapshots.
 */
export function createMorphTestAdapter(host: MorphTestHost): TestRunAdapter<MorphTestSettings, MorphPageSnapshot> {
  let lastApplied: TestScenario<MorphTestSettings> | undefined;

  async function waitSettled(scenario: TestScenario<MorphTestSettings>, context: TestContext): Promise<void> {
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
      const state = host.read();
      const finalMorph = settings.morphKeys[0];
      const poseOk = distance(state.position, expectedMorphPose(settings, finalMorph)) <=
        POSE_TOLERANCE * distance(expectedMorphPose(settings, finalMorph), settings.cameraTarget);
      const ok = frame >= firstFrame + 2 && poseOk && Math.abs(state.uniformMorph - finalMorph) < 1e-9 &&
        state.lodMorph === finalMorph && streamingSettled(host.streaming());
      if (!ok) { settledFrames = 0; settledSince = undefined; }
      else if (frame > lastFrame) { settledFrames++; settledSince ??= performance.now(); }
      lastFrame = frame;
      if (ok && settledFrames >= SETTLE_FRAMES && performance.now() - (settledSince ?? Infinity) >= SETTLE_MS) return;
      if (performance.now() - began > READY_TIMEOUT_MS) {
        throw new Error(`Streaming not settled after ${READY_TIMEOUT_MS / 1000} s: ${JSON.stringify(host.streaming())}`);
      }
      await context.wait(16);
    }
  }

  return {
    capture: () => host.read(),
    apply: (scenario) => {
      lastApplied = scenario;
      host.resetErrors();
      host.applyWorld(scenario.settings);
      const morph = scenario.settings.morphKeys[0];
      host.setMorphFrame(morph, expectedMorphPose(scenario.settings, morph), scenario.settings.cameraTarget);
      host.commitMorph(morph);
    },
    ready: (context, scenario) => {
      const target = scenario ?? lastApplied;
      if (!target) throw new Error('ready() called before apply()');
      return waitSettled(target, context);
    },
    measure: async (scenario, context): Promise<TestObservation> => {
      const settings = scenario.settings;
      if (host.isSampling()) throw new Error('Another frame sampling window is already active');
      const intervals: number[] = [];
      const backlog: number[] = [];
      const trace: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let minResident = Infinity;
      const before = host.streaming();
      host.startSampling();
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
        const status = host.streaming();
        minResident = Math.min(minResident, status.patchesResident);
        backlog.push(status.patchesQueued + status.tilesQueued + status.tilesInFlight);
      });
      let summary: MorphFrameSummary;
      try {
        if (settings.kind === 'sweep') await runSweep(scenario, context, host, trace);
        else await context.wait(scenario.durationMs);
        summary = host.stopSampling();
      } finally {
        offRender();
        if (host.isSampling()) host.stopSampling();
      }
      const state = host.read();
      const after = host.streaming();
      const environment = host.environment();
      const finalMorph = settings.morphKeys[settings.morphKeys.length - 1];
      const expectedPose = expectedMorphPose(settings, finalMorph);
      const poseError = distance(state.position, expectedPose);
      const poseLimit = POSE_TOLERANCE * distance(expectedPose, settings.cameraTarget);
      const mismatches = worldMismatches(state.world, settings);
      const sweepProblems = settings.kind === 'sweep' ? sweepTraceProblems(settings.morphKeys, trace) : [];
      const morphReached = settings.kind === 'sweep'
        ? sweepProblems.length === 0 && state.lodMorph === finalMorph
        : Math.abs(state.uniformMorph - finalMorph) < 1e-9 && state.morph === finalMorph && state.lodMorph === finalMorph;
      const error = host.errors();
      const checks: TestCheck[] = [
        { name: 'World settings applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'Terrain stayed resident throughout', passed: frames > 0 && minResident > 0, detail: `minimum resident patches ${Number.isFinite(minResident) ? minResident : 'n/a'}` },
        { name: 'Morph reached its final state', passed: morphReached,
          detail: settings.kind === 'sweep' ? (sweepProblems.join('; ') || `${trace.length} animation steps`) : `uniform ${state.uniformMorph}, lod ${state.lodMorph}` },
        { name: 'Camera pose follows morph', passed: poseError <= poseLimit, detail: `error ${poseError.toFixed(1)} m of ${poseLimit.toFixed(1)} m allowed` },
        { name: 'Controls locked as configured', passed: state.controls.enabled === settings.controls.enabled && state.controls.damping === settings.controls.damping },
        { name: 'No engine, worker or material error', passed: error === '', detail: error || undefined },
      ];
      const software = environment['softwareRenderer'] === true;
      const frameMetric: TestMetric = {
        name: 'frameInterval', unit: 'ms', source: 'Deltas of engine renderComplete$ timestamps (performance.now); display-cadence quantized, not GPU time',
        samples: intervals, unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed in the window',
      };
      const backlogMetric: TestMetric = {
        name: 'streamingBacklog', unit: 'jobs', source: 'Queued terrain patches + queued and in-flight texture tiles, read on each completed render',
        samples: backlog, unavailableReason: backlog.length ? undefined : 'No frames completed in the window',
      };
      return {
        metrics: [frameMetric, backlogMetric],
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms,
          wallMedianMs: summary.wallMedianMs, wallP95Ms: summary.wallP95Ms, frameVerdict: summary.verdict,
          triangles: after.triangles, drawCalls: after.drawCalls, residentPatches: after.patchesResident,
          residentTiles: after.tilesResident, tilesBakedDuringWindow: after.tilesCompleted - before.tilesCompleted,
          minResidentPatches: Number.isFinite(minResident) ? minResident : null, finalMorph: state.uniformMorph,
        },
        validityIssues: [
          ...summary.invalidReasons,
          ...(summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in measurement window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
        ],
        limitations: [
          'No GPU timestamp query on this page: GPU, shader and texture-bake cost are not measured.',
          'CPU figures are main-thread tick and render time; worker meshing and tile baking run off-thread and are outside them.',
          'Frame intervals are rAF-paced completed renders, quantized by display refresh and capped by it.',
          'Appearance (seams, popping, border and ocean blending) is not judged by these checks and needs human review.',
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
