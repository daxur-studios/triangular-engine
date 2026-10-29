import type { GpuPassKind, IFrameSampleSummary } from 'triangular-engine';
import { modeActionMs, type TestCheck, type TestContext, type TestMetric, type TestObservation, type TestRunAdapter, type TestScenario, type TestSetting } from 'triangular-engine/testing';
import { CAP_SLACK } from 'triangular-engine/lod-surface/core';
import type { PlanetSceneTestSettings } from './planet-scene-tests';

/** What the terrain and renderer did on the last frame. */
export interface PlanetSceneFrameInfo {
  readonly leaves: number;
  readonly drawnLeaves: number;
  readonly surfaceTriangles: number;
  readonly deepestLevel: number;
  readonly capHit: boolean;
  readonly unmet: number;
  readonly leafCap: number;
  readonly drawCalls: number;
  readonly rendererTriangles: number;
  readonly drawingBuffer: readonly [number, number];
}

/** The planet scene page as the adapter sees it: its own setters plus read-only probes. */
export interface PlanetSceneTestHost {
  read(): PlanetSceneTestSettings;
  apply(settings: PlanetSceneTestSettings): void;
  renderedFrames(): number;
  errors(): string;
  resetErrors(): void;
  backendIsWebGpu(): boolean;
  /** What the scene still waits for (the height bake, the terrain's pipeline, the atmosphere's tables), or '' when it is all there. */
  pending(): string;
  frame(): PlanetSceneFrameInfo;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  /** Main-thread ms of the terrain's selection plus instance upload, one sample per rendered frame since the last reset. */
  selectionSamples(): readonly number[];
  /** Leaves per frame since the last reset (same frames as {@link selectionSamples}). */
  leafSamples(): readonly number[];
  resetSamples(): void;
  /** Places the camera on the scripted move of the case, `t` (0..1) into it; `undefined` returns to the named pose. */
  setMotionProgress(t: number | undefined): void;
  isSampling(): boolean;
  startSampling(): void;
  gpuSamplesSoFar(): readonly number[];
  stopSampling(): IFrameSampleSummary;
  environment(): Readonly<Record<string, TestSetting>>;
  thumbnail?(): Promise<Blob | undefined>;
}

/** Includes the height bake (seconds in the worker), the cell lookup of the terrain's material and the atmosphere's table bake (1-2 s). */
const READY_TIMEOUT_MS = 90_000;
const STALL_MS = 5_000;
const SETTLE_FRAMES = 3;
/**
 * The engine's frame timer gives up on a readback while the GPU is busy compiling a pipeline: expected while the scene settles
 * (the terrain, the sky and the froxel table each compile on their first frames), not a fault. Tolerated there only; inside
 * the measured window it still fails the case. Same rule as the lod-surface lab's adapter.
 */
const GPU_TIMER_ERROR = /^gpuTiming: GpuReadbackTimeoutError/;
/** Most such timeouts one settle tolerates; more means the GPU is not coming back. */
const MAX_GPU_TIMER_ERRORS = 3;
const MIN_WINDOW_FRAMES = 60;
/** `performance.now()` is coarsened to 0.1 ms here; GPU timestamps step at about 1 us. */
const TIMER_STEP_MS = 0.1;
const GPU_STEP_MS = 0.001;
/** A frame whose terrain selection takes longer than this during a scripted move is a rebuild storm. */
const STORM_MS = 8;

const GPU_PASS_METRICS: readonly { kind: GpuPassKind; name: string; source: string }[] = [
  {
    kind: 'scene', name: 'gpuScenePass',
    source: 'WebGPU timestamps, summed per frame over every pass the timer labels `scene`: the main scene pass (terrain, sky backdrop, clear) and any atmosphere table pass drawn as a scene pass; see details gpuPassLabel:*',
  },
  { kind: 'output', name: 'gpuOutputPass', source: 'WebGPU timestamps of the renderer output pass (tone mapping, colour space)' },
  {
    kind: 'fullscreen', name: 'gpuFullscreenPasses',
    source: 'WebGPU timestamps, summed per frame over every full-screen quad pass other than the output pass (atmosphere tables drawn as quads, if any); absent when the frame has none',
  },
];

export function settingsMismatches(actual: PlanetSceneTestSettings, expected: PlanetSceneTestSettings): string[] {
  const out: string[] = [];
  for (const key of ['pose', 'terrain', 'atmosphere', 'morph', 'motion'] as const) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
  }
  return out;
}

const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

async function waitForFrames(host: PlanetSceneTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

export function createPlanetSceneTestAdapter(host: PlanetSceneTestHost): TestRunAdapter<PlanetSceneTestSettings, PlanetSceneTestSettings> {
  /** GPU timestamp readback timeouts the latest settle tolerated; reported in the result's details. */
  let settleTimerErrors = 0;

  async function waitSettled(scenario: TestScenario<PlanetSceneTestSettings>, context: TestContext): Promise<void> {
    const began = performance.now();
    let settled = 0;
    let lastFrame = host.renderedFrames();
    let timerErrors = 0;
    settleTimerErrors = 0;
    /** Throws on an error that is not a tolerated timer timeout; true when it cleared one (which restarts the settle). */
    const drainErrors = (): boolean => {
      const error = host.errors();
      if (!error) return false;
      if (!GPU_TIMER_ERROR.test(error)) throw new Error(error);
      if (++timerErrors > MAX_GPU_TIMER_ERRORS) {
        throw new Error(`${error} (${timerErrors} GPU timestamp readback timeouts while settling, at most ${MAX_GPU_TIMER_ERRORS} tolerated)`);
      }
      host.resetErrors();
      settleTimerErrors = timerErrors;
      return true;
    };
    // A timeout can still arrive just after the last settled frame.
    do {
      settled = 0;
      while (settled < SETTLE_FRAMES) {
        const tolerated = drainErrors();
        const frame = host.renderedFrames();
        const mismatches = settingsMismatches(host.read(), scenario.settings);
        const pending = host.pending();
        if (tolerated || pending !== '' || mismatches.length > 0) settled = 0;
        else if (frame > lastFrame) settled++;
        lastFrame = frame;
        if (performance.now() - began > READY_TIMEOUT_MS) {
          throw new Error(`Scene not settled after ${READY_TIMEOUT_MS / 1000} s: ${[pending && `waiting for ${pending}`, ...mismatches].filter(Boolean).join('; ') || 'no frames rendered'}`);
        }
        await context.wait(16);
      }
    } while (drainErrors());
  }

  /** Runs the scripted move over the action time, one step per rendered frame; returns the seconds it ran. */
  async function move(scenario: TestScenario<PlanetSceneTestSettings>, context: TestContext): Promise<number> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setMotionProgress(0);
    while (true) {
      const elapsed = performance.now() - began;
      host.setMotionProgress(Math.min(1, elapsed / durationMs));
      if (elapsed >= durationMs) return elapsed / 1000;
      await context.wait(16);
    }
  }

  return {
    windowModes: true,
    capture: () => host.read(),
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => waitSettled(scenario, context),
    measure: async (scenario, context): Promise<TestObservation> => {
      if (host.isSampling()) throw new Error('Another frame sampling window is already active');
      const settings = scenario.settings;
      const moving = settings.motion !== undefined;
      const intervals: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let summary: IFrameSampleSummary;
      // A scripted move clears itself when it ends, so its state is checked while it still runs.
      let motionMismatches: string[] = [];
      let motionSeconds = 0;
      host.resetSamples();
      host.startSampling();
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
      });
      try {
        if (moving) {
          motionSeconds = await move(scenario, context);
          motionMismatches = settingsMismatches(host.read(), settings);
        } else {
          await context.measureWindow(scenario, [
            { name: 'frameInterval', samples: () => intervals, resolution: TIMER_STEP_MS },
            ...(host.environment()['gpu.timestampQuery'] === true
              ? [{ name: 'gpuFrame', samples: () => host.gpuSamplesSoFar(), resolution: GPU_STEP_MS }] : []),
          ]);
        }
        summary = host.stopSampling();
      } finally {
        offRender();
        if (host.isSampling()) host.stopSampling();
        if (moving) host.setMotionProgress(undefined);
      }
      const selection = [...host.selectionSamples()];
      const leaves = [...host.leafSamples()];
      const info = host.frame();
      const environment = host.environment();
      const mismatches = moving ? motionMismatches : settingsMismatches(host.read(), settings);
      const error = host.errors();
      const checks: TestCheck[] = [
        { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(environment['backend']) },
        {
          name: 'Terrain drawn in one draw call', passed: !settings.terrain || (info.drawnLeaves > 0 && info.drawCalls >= 1),
          detail: settings.terrain ? `${info.drawnLeaves} leaves, ${info.drawCalls} draw calls in the scene` : 'terrain not in the scene',
        },
        {
          name: 'Leaf count within the cap', passed: !settings.terrain || maxOf(leaves) <= info.leafCap + CAP_SLACK,
          detail: `most ${maxOf(leaves)} leaves, cap ${info.leafCap}${info.capHit ? `, cap hit with ${info.unmet} unmet` : ''}`,
        },
        { name: 'No engine or console error', passed: error === '', detail: error || undefined },
      ];
      if (moving && settings.terrain) {
        checks.push({
          name: `No rebuild storm: every frame's terrain selection under ${STORM_MS} ms`, passed: selection.length > 0 && maxOf(selection) < STORM_MS,
          detail: `most ${maxOf(selection).toFixed(2)} ms over ${selection.length} frames`,
        });
      }
      const passes = summary.gpuPasses ?? null;
      if (passes) {
        checks.push({
          name: 'GPU timer self-test', passed: passes.selfTest.passed,
          detail: passes.selfTest.issues.join('; ') || `${passes.frames} frames, timestamp step ${passes.resolution.resolutionNs} ns`,
        });
      }
      const timestampQuery = environment['gpu.timestampQuery'] === true;
      const software = environment['gpu.software'] === true;
      const metrics: TestMetric[] = [
        {
          name: 'selectionCpu', unit: 'ms', samples: selection, optional: !settings.terrain,
          source: "Main thread, per frame: the terrain's quadtree rebuild, instance upload and move to the camera (performance.now, 0.1 ms steps)",
          unavailableReason: selection.length ? undefined : settings.terrain ? 'No frame selected in the window' : 'No terrain in the scene',
        },
        { name: 'leaves', unit: 'count', samples: leaves, optional: !settings.terrain, source: 'Leaves of the selected tree per frame (drawn and culled)', unavailableReason: leaves.length ? undefined : 'No terrain in the scene' },
        { name: 'drawnLeaves', unit: 'count', samples: [info.drawnLeaves], source: 'Instances the terrain drew on the last frame' },
        { name: 'surfaceTriangles', unit: 'count', samples: [info.surfaceTriangles], source: 'Drawn leaves x 2 N^2 on the last frame (terrain only)' },
        { name: 'rendererTriangles', unit: 'count', samples: [info.rendererTriangles], source: 'Renderer triangle counter on the last frame: the terrain, the sky backdrop and any table passes' },
        { name: 'drawCalls', unit: 'count', samples: [info.drawCalls], source: 'Renderer draw calls on the last frame: the terrain (1), the sky and any table passes' },
        {
          name: 'frameInterval', unit: 'ms', samples: intervals, source: 'Deltas of renderComplete$ timestamps; display-cadence quantized, not GPU time',
          unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed',
        },
        ...GPU_PASS_METRICS.map(({ kind, name, source }): TestMetric => {
          const samples = passes?.byKind[kind]?.samples ?? [];
          return {
            name, unit: 'ms', optional: true, source, samples,
            unavailableReason: samples.length ? undefined : timestampQuery ? `No ${kind} pass resolved in the window` : 'No GPU timestamp query on this renderer',
          };
        }),
        {
          name: 'gpuPassTotal', unit: 'ms', optional: true, source: 'WebGPU timestamps, all passes of a frame summed (scene, fullscreen, output)',
          samples: passes?.total.samples ?? [],
          unavailableReason: passes ? undefined : timestampQuery ? 'No per-pass GPU timestamps resolved in the window' : 'No GPU timestamp query on this renderer',
        },
      ];
      const labelDetails: Record<string, TestSetting> = {};
      for (const [label, stat] of Object.entries(passes?.byLabel ?? {})) labelDetails[`gpuPassLabel:${label}`] = stat.medianMs;
      return {
        metrics,
        checks,
        details: {
          clouds: 'placeholder',
          gpuAdapter: String(environment['gpu.description'] ?? 'unknown'),
          gpuVendor: String(environment['gpu.vendor'] ?? 'unknown'),
          planetRadiusM: environment['planet.radiusM'] ?? null,
          planetWorld: environment['planet.world'] ?? null,
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms, frameVerdict: summary.verdict,
          gpuWholeRenderMedianMs: summary.gpuMedianMs, gpuPassTotalMedianMs: passes ? passes.total.medianMs : null,
          leaves: info.leaves, drawnLeaves: info.drawnLeaves, deepestLevel: info.deepestLevel, capHit: info.capHit, unmet: info.unmet,
          drawCalls: info.drawCalls, rendererTriangles: info.rendererTriangles,
          drawingBufferWidth: info.drawingBuffer[0], drawingBufferHeight: info.drawingBuffer[1],
          ...(moving ? { motionSeconds } : {}),
          ...labelDetails,
          ...(settleTimerErrors > 0 ? { settleTimerErrorsTolerated: settleTimerErrors } : {}),
        },
        validityIssues: [
          ...(moving ? [] : summary.invalidReasons),
          ...(!moving && summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in the window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
        ],
        limitations: [
          'Clouds are a placeholder: <planetClouds> has its own plan, so no cloud pass is drawn or timed.',
          'The GPU timer splits by render pass, not by layer. The terrain and the sky backdrop share the main scene pass; read the sky\'s cost from the `-atmosphere-off` partner of a case (same view, sky, lighting and haze off).',
          'Compute passes are not split by the timer. The atmosphere\'s table updates that run as compute are inside the whole-frame figure only.',
          'The terrain is selected every frame from the active camera; draw calls and renderer triangles are the last frame\'s counters.',
          'The morph is 0 (the globe) in every case: the terrain does not bend until step G6.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.setMotionProgress(undefined);
      host.apply(snapshot);
      await waitForFrames(host, 2, context);
    },
    environment: () => host.environment(),
    ...(host.thumbnail ? {
      thumbnail: async (scenario: TestScenario<PlanetSceneTestSettings>, context: TestContext) => {
        if (context.repetition > 1 || scenario.settings.motion !== undefined) return undefined;
        const image = await host.thumbnail?.();
        return image ? [image] : undefined;
      },
    } : {}),
  };
}
