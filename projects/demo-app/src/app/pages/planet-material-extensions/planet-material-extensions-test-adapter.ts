import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import type { ExtensionsTestSettings, ExtensionsVec3 } from './planet-material-extensions-tests';

/** Every piece of page state a scenario changes, captured read-only and restorable as a unit. */
export interface ExtensionsPageSnapshot {
  readonly road: boolean;
  readonly eclipse: boolean;
  readonly lights: boolean;
  readonly sunDegrees: number;
  readonly moonDegrees: number;
  readonly moonVisible: boolean;
  /** Actual camera and orbit target, read from the live controls rather than the page's input literals. */
  readonly position: ExtensionsVec3;
  readonly target: ExtensionsVec3;
  readonly up: ExtensionsVec3;
  readonly controls: { readonly enabled: boolean; readonly damping: boolean };
}

export interface ExtensionsFrameSummary {
  readonly frames: number;
  readonly cpuMedianMs: number;
  readonly cpuP95Ms: number;
  readonly wallMedianMs: number;
  readonly wallP95Ms: number;
  readonly invalidReasons: readonly string[];
  readonly verdict: string;
}

/** What the page offers the adapter: its normal actions plus read-only probes. Implemented by the page. */
export interface ExtensionsTestHost {
  read(): ExtensionsPageSnapshot;
  /** Applies toggles, angles and control locks through the page's own actions. Synchronous. */
  applyScene(settings: ExtensionsTestSettings): void;
  /** Places the camera and orbit target exactly now (the controls are updated, so the frame about to draw uses it). */
  setCameraPose(position: ExtensionsVec3, target: ExtensionsVec3): void;
  restore(snapshot: ExtensionsPageSnapshot): void;
  /** The material's `stackKey`, which names the slot entries the compiled program was built from. */
  stackKey(): string;
  rendererReady(): boolean;
  /** Awaits the renderer's pipeline compilation for the current scene, when the renderer offers it. */
  compile(signal: AbortSignal): Promise<void>;
  /** Draw statistics of the last completed render. */
  drawStats(): { readonly triangles: number; readonly drawCalls: number };
  renderedFrames(): number;
  /** First engine, window or console error since `resetErrors`, or ''. */
  errors(): string;
  resetErrors(): void;
  onBeforeRender(callback: () => void): () => void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  isSampling(): boolean;
  startSampling(): void;
  stopSampling(): ExtensionsFrameSummary;
  invalidateSampling(reason: string): void;
  environment(): Readonly<Record<string, TestSetting>>;
}

const READY_TIMEOUT_MS = 60_000;
const READY_FRAMES = 3;
const STALL_MS = 5_000;
const MIN_WINDOW_FRAMES = 60;
/** A static window is held open until this many renders completed, so a slow renderer cannot pass or fail on an empty window. */
const MIN_ACTION_FRAMES = 3;
const MAX_WINDOW_EXTENSION_MS = 20_000;
/** The page's globe is a 128 x 64 `SphereGeometry`: 128 * 63 * 2 triangles, so any frame that drew it has at least this many. */
const MIN_PLANET_TRIANGLES = 16_000;
const POSE_TOLERANCE = 1e-4;

function distance(a: ExtensionsVec3, b: ExtensionsVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The camera's place after `fraction` of the sweep: its offset from the target rotated round +Y, height and distance kept. */
export function orbitPose(start: ExtensionsVec3, target: ExtensionsVec3, sweepDegrees: number, fraction: number): ExtensionsVec3 {
  const angle = (sweepDegrees * Math.PI / 180) * Math.max(0, Math.min(1, fraction));
  const x = start[0] - target[0];
  const z = start[2] - target[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [target[0] + x * cos + z * sin, start[1], target[2] - x * sin + z * cos];
}

/** The scene state the page reports against the scenario's inputs. */
export function sceneMismatches(actual: ExtensionsPageSnapshot, expected: ExtensionsTestSettings): string[] {
  const out: string[] = [];
  for (const key of ['road', 'eclipse', 'lights', 'sunDegrees', 'moonDegrees'] as const) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${String(expected[key])}, found ${String(actual[key])}`);
  }
  if (actual.moonVisible !== expected.eclipse) out.push(`moonVisible: expected ${String(expected.eclipse)}, found ${String(actual.moonVisible)}`);
  return out;
}

/** The compiled slot entries, read from the material rather than from the page's own flags. */
export function stackMismatches(stackKey: string, expected: ExtensionsTestSettings): string[] {
  const out: string[] = [];
  const slots: readonly (readonly [string, boolean])[] = [['roads', expected.road], ['moon', expected.eclipse], ['cityLights', expected.lights]];
  for (const [id, on] of slots) {
    if (stackKey.includes(id) !== on) out.push(`${id}: expected ${on ? 'present' : 'absent'} in stack "${stackKey}"`);
  }
  return out;
}

/** An orbit that skipped back, never arrived or recorded nothing is a defect, not a slow frame. */
export function orbitTraceProblems(trace: readonly number[]): string[] {
  if (trace.length < 2) return ['fewer than two orbit frames recorded'];
  const problems: string[] = [];
  for (let i = 1; i < trace.length; i++) {
    if (trace[i] < trace[i - 1]) { problems.push(`orbit stepped back at frame ${i}`); break; }
  }
  if (trace[0] > 0.5) problems.push(`orbit started at ${trace[0].toFixed(3)}, not near 0`);
  if (trace[trace.length - 1] !== 1) problems.push(`final orbit fraction ${trace[trace.length - 1]} is not 1`);
  return problems;
}

async function waitForFrames(host: ExtensionsTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

function runOrbit(scenario: TestScenario<ExtensionsTestSettings>, context: TestContext, host: ExtensionsTestHost, trace: number[]): Promise<void> {
  const settings = scenario.settings;
  return new Promise<void>((resolve, reject) => {
    let startedAt: number | undefined;
    let lastRenderAt = performance.now();
    let endReached = false;
    let done = false;
    const cleanup = () => { offBefore(); offRender(); clearInterval(stall); context.signal.removeEventListener('abort', onAbort); };
    const fail = (error: unknown) => { if (done) return; done = true; cleanup(); reject(error); };
    const onAbort = () => fail(context.signal.reason);
    const offBefore = host.onBeforeRender(() => {
      if (done || endReached) return;
      const now = performance.now();
      startedAt ??= now;
      const fraction = Math.min(1, (now - startedAt) / scenario.durationMs);
      endReached = fraction >= 1;
      host.setCameraPose(orbitPose(settings.cameraPosition, settings.cameraTarget, settings.orbitSweepDegrees, fraction), settings.cameraTarget);
      trace.push(fraction);
    });
    // The frame whose pose was the last step has now been drawn.
    const offRender = host.onRenderComplete(() => {
      lastRenderAt = performance.now();
      if (endReached && !done) { done = true; cleanup(); resolve(); }
    });
    const stall = setInterval(() => {
      if (performance.now() - lastRenderAt > STALL_MS) fail(new Error(`Rendering stalled for ${STALL_MS} ms during the orbit`));
    }, 500);
    if (context.signal.aborted) onAbort(); else context.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Game-owned adapter for the planet material extensions page. All page knowledge sits behind
 * {@link ExtensionsTestHost}; the shared runner only sees settings, observations and snapshots.
 */
export function createExtensionsTestAdapter(
  host: ExtensionsTestHost, readyTimeoutMs = READY_TIMEOUT_MS,
): TestRunAdapter<ExtensionsTestSettings, ExtensionsPageSnapshot> {
  async function waitReady(scenario: TestScenario<ExtensionsTestSettings>, context: TestContext): Promise<void> {
    const settings = scenario.settings;
    const began = performance.now();
    const expired = () => performance.now() - began > readyTimeoutMs;
    while (!host.rendererReady()) {
      const error = host.errors();
      if (error) throw new Error(error);
      if (expired()) throw new Error(`Renderer not initialised after ${readyTimeoutMs / 1000} s`);
      await context.wait(16);
    }
    // A toggled slot is a new program: wait for it to be compiled instead of measuring its compile hitch.
    await host.compile(context.signal);
    const firstFrame = host.renderedFrames();
    let stableSince: number | undefined;
    while (true) {
      const error = host.errors();
      if (error) throw new Error(error);
      const state = host.read();
      const ok = host.renderedFrames() >= firstFrame + READY_FRAMES && sceneMismatches(state, settings).length === 0 &&
        stackMismatches(host.stackKey(), settings).length === 0 && distance(state.position, settings.cameraPosition) <= POSE_TOLERANCE;
      if (!ok) stableSince = undefined;
      else {
        // Ready only once the applied state has held for a few more completed renders.
        stableSince ??= host.renderedFrames();
        if (host.renderedFrames() >= stableSince + READY_FRAMES) return;
      }
      if (expired()) throw new Error(`Scene not ready after ${readyTimeoutMs / 1000} s: ${[...sceneMismatches(state, settings), ...stackMismatches(host.stackKey(), settings)].join('; ') || 'frames or camera pose'}`);
      await context.wait(16);
    }
  }

  return {
    capture: () => host.read(),
    apply: (scenario) => {
      host.resetErrors();
      host.applyScene(scenario.settings);
      host.setCameraPose(scenario.settings.cameraPosition, scenario.settings.cameraTarget);
    },
    ready: (context, scenario) => waitReady(scenario, context),
    measure: async (scenario, context): Promise<TestObservation> => {
      const settings = scenario.settings;
      if (host.isSampling()) throw new Error('Another frame sampling window is already active');
      const intervals: number[] = [];
      const trace: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let windowExtendedMs = 0;
      const onHidden = () => { if (document.hidden) host.invalidateSampling('hidden'); };
      const onBlur = () => host.invalidateSampling('unfocused');
      document.addEventListener('visibilitychange', onHidden);
      window.addEventListener('blur', onBlur);
      host.startSampling();
      if (document.hidden) host.invalidateSampling('hidden at start');
      if (!document.hasFocus()) host.invalidateSampling('unfocused at start');
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
      });
      let summary: ExtensionsFrameSummary;
      try {
        if (settings.kind === 'orbit') await runOrbit(scenario, context, host, trace);
        else {
          await context.wait(scenario.durationMs);
          const extendedFrom = performance.now();
          while (frames < MIN_ACTION_FRAMES && performance.now() - extendedFrom < MAX_WINDOW_EXTENSION_MS) await context.wait(16);
          windowExtendedMs = Math.round(performance.now() - extendedFrom);
        }
        summary = host.stopSampling();
      } finally {
        offRender();
        document.removeEventListener('visibilitychange', onHidden);
        window.removeEventListener('blur', onBlur);
        if (host.isSampling()) host.stopSampling();
      }
      const state = host.read();
      const draw = host.drawStats();
      const environment = host.environment();
      const expectedEnd = settings.kind === 'orbit'
        ? orbitPose(settings.cameraPosition, settings.cameraTarget, settings.orbitSweepDegrees, 1) : settings.cameraPosition;
      const poseError = distance(state.position, expectedEnd);
      const sceneIssues = sceneMismatches(state, settings);
      const stackIssues = stackMismatches(host.stackKey(), settings);
      const orbitIssues = settings.kind === 'orbit' ? orbitTraceProblems(trace) : [];
      const error = host.errors();
      const backend = String(environment['backend']);
      const requested = String(environment['requestedBackend']);
      const checks: TestCheck[] = [
        { name: 'Scene settings applied as specified', passed: sceneIssues.length === 0, detail: sceneIssues.join('; ') || undefined },
        { name: 'Material stack matches the enabled slots', passed: stackIssues.length === 0, detail: stackIssues.join('; ') || host.stackKey() },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'Planet drawn in the last frame', passed: draw.triangles >= MIN_PLANET_TRIANGLES, detail: `${draw.triangles} triangles, ${draw.drawCalls} draw calls` },
        { name: settings.kind === 'orbit' ? 'Camera orbit completed at its destination' : 'Camera held at its pose',
          passed: poseError <= POSE_TOLERANCE && orbitIssues.length === 0,
          detail: settings.kind === 'orbit' ? (orbitIssues.join('; ') || `${trace.length} orbit steps, end error ${poseError.toExponential(1)}`) : `error ${poseError.toExponential(1)}` },
        { name: 'Controls locked as configured', passed: state.controls.enabled === settings.controls.enabled && state.controls.damping === settings.controls.damping },
        { name: 'Requested renderer backend in use', passed: backend === requested, detail: `requested ${requested}, running ${backend}` },
        { name: 'No engine, window or console error', passed: error === '', detail: error || undefined },
      ];
      const software = environment['softwareRenderer'];
      const frameMetric: TestMetric = {
        name: 'frameInterval', unit: 'ms', source: 'Deltas of engine renderComplete$ timestamps (performance.now); display-cadence quantized, not GPU time',
        samples: intervals, unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed in the window',
      };
      const gpuMetric: TestMetric = {
        name: 'gpuFrameTime', unit: 'ms', source: 'none', samples: [], optional: true,
        unavailableReason: 'This page does not enable the engine gpuTiming option (WebGPU timestamp queries), so GPU time is not measured',
      };
      return {
        metrics: [frameMetric, gpuMetric],
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms,
          wallMedianMs: summary.wallMedianMs, wallP95Ms: summary.wallP95Ms, frameVerdict: summary.verdict,
          triangles: draw.triangles, drawCalls: draw.drawCalls, stackKey: host.stackKey(), orbitSteps: trace.length, windowExtendedMs,
        },
        validityIssues: [
          ...summary.invalidReasons,
          ...(summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in measurement window`] : []),
          ...(software === true ? ['Software renderer: functional evidence only, not hardware performance'] : []),
          ...(software === null ? ['GPU device unknown: hardware performance cannot be established'] : []),
        ],
        limitations: [
          'No GPU timestamp query on this page: GPU, shader and recompile cost are not measured.',
          'CPU figures are main-thread tick and render time; they do not include GPU execution.',
          'Frame intervals are rAF-paced completed renders, quantized by display refresh and capped by it; a scene lighter than the refresh interval reads as the refresh interval.',
          'Material variants are compiled before the window (renderer compileAsync), so program compile cost is excluded by design.',
          'Appearance (road continuity, eclipse shadow, night lights, orbit smoothness) is not judged by these checks and needs human review.',
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
