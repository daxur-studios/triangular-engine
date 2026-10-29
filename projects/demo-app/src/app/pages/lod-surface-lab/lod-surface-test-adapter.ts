import type { GpuPassKind, IFrameSampleSummary } from 'triangular-engine';
import { modeActionMs, type TestCheck, type TestContext, type TestMetric, type TestObservation, type TestRunAdapter, type TestScenario, type TestSetting } from 'triangular-engine/testing';
import type { CrackCount } from './lod-crack-probe';
import { percentile, CAP_SLACK, type SelectorStats } from 'triangular-engine/lod-surface/core';
import { crackExpectation, type LodSurfaceTestSettings } from './lod-surface-tests';

/** What baking a texture height source cost (Plan 059 step 2); absent for analytic sources. */
export interface LodSurfaceBakeInfo {
  readonly source: string;
  /** Texels per face side. */
  readonly side: number;
  readonly faces: number;
  /** Sampling time of each face, ms (in the worker). */
  readonly bakeMsPerFace: readonly number[];
  readonly pyramidMs: number;
  /** Wall time from request to result on the main thread: worker start, bake and transfer. */
  readonly roundTripMs: number;
  /** CPU time of handing the texture to the renderer (`initTexture`); the GPU copy itself runs after it. Null if it failed. */
  readonly uploadMs: number | null;
  readonly textureMB: number;
  /** |CPU twin - source| at the probe points, metres (`twinErrors`); the interpolation error of the texture, not a GPU read-back. */
  readonly twinErrorM: readonly number[];
  /** Cell planet only: building its world, ms, in the worker (once per world; later bakes of it report the same figure). */
  readonly worldBuildMs?: number;
}

/** What the selector and renderer did on the last frame. */
export interface LodSurfaceFrameInfo {
  readonly stats: Readonly<SelectorStats>;
  readonly instances: number;
  readonly trianglesPerLeaf: number;
  readonly drawCalls: number;
  readonly rendererTriangles: number;
  readonly drawingBuffer: readonly [number, number];
  readonly bake?: LodSurfaceBakeInfo;
}

/** The lab page as the adapter sees it: its own setters plus read-only probes. */
export interface LodSurfaceTestHost {
  read(): LodSurfaceTestSettings;
  apply(settings: LodSurfaceTestSettings): void;
  renderedFrames(): number;
  errors(): string;
  resetErrors(): void;
  backendIsWebGpu(): boolean;
  /** False while a baked height source is still baking: the surface drawn is not yet the one the settings name. */
  heightSourceReady?(): boolean;
  /** False while the newest surface mesh is still compiling its pipeline (`compileAsync`): it is not drawn yet. */
  pipelineReady?(): boolean;
  frame(): LodSurfaceFrameInfo;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  /** Main-thread ms of selection plus instance upload, one sample per frame since the last reset. */
  selectionSamples(): readonly number[];
  selectOnlySamples?(): readonly number[];
  uploadOnlySamples?(): readonly number[];
  /** Leaves per frame since the last reset (same frames as {@link selectionSamples}). */
  leafSamples(): readonly number[];
  /** On-screen nodes that changed between split and merged per frame since the last reset (same frames; `visibleNewSplits + visibleMerges`). */
  levelChangeSamples(): readonly number[];
  /** The same with every node, frustum entries and exits included (`newSplits + merges`). */
  levelChangeAllSamples(): readonly number[];
  resetSamples(): void;
  /** Places the camera on the scripted zoom (0 eye, 1 orbit); `undefined` returns to the named pose. */
  setZoomProgress(t: number | undefined): void;
  /** Places the camera on the scripted sweep of the case's pose, `seconds` into it; `undefined` returns to the named pose. */
  setSweepTime(seconds: number | undefined): void;
  /** Places the camera on the scripted turn of the case's pose (heading only), `seconds` into it; `undefined` returns to the named pose. */
  setTurnTime(seconds: number | undefined): void;
  isSampling(): boolean;
  startSampling(): void;
  gpuSamplesSoFar(): readonly number[];
  stopSampling(): IFrameSampleSummary;
  crackProbe(): Promise<CrackCount & { readonly width: number; readonly height: number }>;
  environment(): Readonly<Record<string, TestSetting>>;
  thumbnail?(): Promise<Blob | undefined>;
}

/** Includes a bake: the cell planet's six faces take about ten seconds on a laptop, and a first case also builds its world. */
const READY_TIMEOUT_MS = 60_000;
const STALL_MS = 5_000;
const SETTLE_FRAMES = 3;
/**
 * The engine's frame timer gives up on a readback while the GPU is busy compiling a pipeline: expected while the lab settles
 * (a first pipeline can still stall it) and around a crack probe (its first run compiles `probeMaterial`), not a fault.
 * Tolerated in those two places only; inside the measured window it still fails the case.
 */
const GPU_TIMER_ERROR = /^gpuTiming: GpuReadbackTimeoutError/;
/** Most such timeouts one settle tolerates; more means the GPU is not coming back. */
const MAX_GPU_TIMER_ERRORS = 2;
const MIN_WINDOW_FRAMES = 60;
/** `performance.now()` is coarsened to 0.1 ms here; GPU timestamps step at about 1 µs. */
const TIMER_STEP_MS = 0.1;
const GPU_STEP_MS = 0.001;
/** A frame whose selection takes longer than this during the zoom is a rebuild storm (L5 asks for 0.2 ms p95). */
const STORM_MS = 8;

const GPU_PASS_METRICS: readonly { kind: GpuPassKind; name: string; source: string }[] = [
  { kind: 'scene', name: 'gpuScenePass', source: 'WebGPU timestamps of the main scene pass: the LOD surface (the only mesh) plus clear' },
  { kind: 'output', name: 'gpuOutputPass', source: 'WebGPU timestamps of the renderer output pass (tone mapping, colour space)' },
];

export function settingsMismatches(actual: LodSurfaceTestSettings, expected: LodSurfaceTestSettings): string[] {
  const out: string[] = [];
  for (const key of Object.keys(expected) as (keyof LodSurfaceTestSettings)[]) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
  }
  if (actual.motion !== expected.motion) out.push(`motion: expected ${expected.motion}, found ${actual.motion}`);
  return [...new Set(out)];
}

async function waitForFrames(host: LodSurfaceTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

/** Bake cost metrics of a texture source; none for an analytic one. Optional: they describe the setup, not the window. */
function bakeMetrics(bake: LodSurfaceBakeInfo | undefined): TestMetric[] {
  if (!bake) return [];
  const sum = bake.bakeMsPerFace.reduce((a, b) => a + b, 0);
  return [
    { name: 'bakeMsPerFace', unit: 'ms', optional: true, samples: [...bake.bakeMsPerFace], source: 'Worker sampling time of each face texture (performance.now)' },
    { name: 'bakeMs', unit: 'ms', optional: true, samples: [sum + bake.pyramidMs], source: 'Worker time: all faces plus the min/max pyramid' },
    { name: 'uploadMs', unit: 'ms', optional: true, samples: bake.uploadMs === null ? [] : [bake.uploadMs], source: 'Main-thread time of renderer.initTexture; GPU copy time is not included', unavailableReason: bake.uploadMs === null ? 'initTexture failed or the renderer was not ready' : undefined },
    { name: 'textureMB', unit: 'MB', optional: true, samples: [bake.textureMB], source: 'Float32 height texels of all faces (10^6 bytes)' },
    ...(bake.worldBuildMs === undefined ? [] : [{ name: 'worldBuildMs', unit: 'ms', optional: true, samples: [bake.worldBuildMs], source: 'Worker time of buildCellPlanetWorld, once per world (not part of bakeMs)' } satisfies TestMetric]),
    {
      name: 'twinVsSamplerErrorM', unit: 'm', optional: true, samples: [...bake.twinErrorM],
      source: '|CPU twin bilinear - direct source value| at 64 off-texel lattice points over the faces; the interpolation error of the texture, NOT a GPU read-back',
      unavailableReason: bake.twinErrorM.length ? undefined : 'No probe points',
    },
  ];
}

const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

/** Level churn of a moving case: the per-frame series and its rate over the seconds the motion ran. */
function levelChangeMetrics(changes: readonly number[], all: readonly number[], seconds: number): TestMetric[] {
  const total = changes.reduce((a, b) => a + b, 0);
  const totalAll = all.reduce((a, b) => a + b, 0);
  const rated = seconds > 0 && changes.length > 0;
  return [
    {
      name: 'levelChanges', unit: 'count', samples: [...changes],
      source: 'Per frame, on screen only: nodes split in this tree and not the last (visibleNewSplits) plus nodes split in the last and not this (visibleMerges), visible in both trees; 0 for a repeated view',
      unavailableReason: changes.length ? undefined : 'No frame selected in the window',
    },
    {
      name: 'levelChangesPerSecond', unit: 'count/s', samples: rated ? [total / seconds] : [],
      source: 'Sum of levelChanges over the seconds the motion ran, first swing included',
      unavailableReason: rated ? undefined : 'No motion time or no frames',
    },
    {
      name: 'levelChangesAll', unit: 'count/s', optional: true, samples: rated ? [totalAll / seconds] : [],
      source: 'Per second like levelChangesPerSecond, but counting every node, frustum entries and exits included (newSplits + merges)',
      unavailableReason: rated ? undefined : 'No motion time or no frames',
    },
  ];
}

export function createLodSurfaceTestAdapter(host: LodSurfaceTestHost): TestRunAdapter<LodSurfaceTestSettings, LodSurfaceTestSettings> {
  /** GPU timestamp readback timeouts the latest settle tolerated (see {@link GPU_TIMER_ERROR}); reported in the result's details. */
  let settleTimerErrors = 0;

  async function waitSettled(scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext): Promise<void> {
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
        if (tolerated || host.heightSourceReady?.() === false || host.pipelineReady?.() === false) settled = 0;
        else if (mismatches.length > 0) settled = 0;
        else if (frame > lastFrame) settled++;
        lastFrame = frame;
        if (performance.now() - began > READY_TIMEOUT_MS) {
          throw new Error(`Lab not settled after ${READY_TIMEOUT_MS / 1000} s: ${mismatches.join('; ') || 'no frames rendered'}`);
        }
        await context.wait(16);
      }
    } while (drainErrors());
  }

  /** Flies the scripted zoom over the action time, one step per rendered frame. */
  async function zoom(scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext): Promise<void> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setZoomProgress(0);
    while (true) {
      const t = (performance.now() - began) / durationMs;
      host.setZoomProgress(Math.min(1, t));
      if (t >= 1) break;
      await context.wait(16);
    }
  }

  /** Swings the camera over the action time on the sweep path's clock; returns the seconds it ran. */
  async function sweep(scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext): Promise<number> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setSweepTime(0);
    while (true) {
      const elapsed = performance.now() - began;
      host.setSweepTime(Math.min(elapsed, durationMs) / 1000);
      if (elapsed >= durationMs) return elapsed / 1000;
      await context.wait(16);
    }
  }

  /** Swings the heading over the action time on the turn path's clock; returns the seconds it ran. */
  async function turn(scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext): Promise<number> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setTurnTime(0);
    while (true) {
      const elapsed = performance.now() - began;
      host.setTurnTime(Math.min(elapsed, durationMs) / 1000);
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
      const intervals: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let summary: IFrameSampleSummary;
      // A scripted motion clears itself when it ends, so its state is checked while it still runs.
      let motionMismatches: string[] = [];
      let motionSeconds = 0;
      const moving = settings.motion !== undefined;
      let probeTimerErrors = 0;
      /**
       * Runs a crack probe (and the frames after it): a readback timeout it alone introduces is cleared and counted, like
       * the planet shape lab's probes. An error already present before it, or any other error, stays.
       */
      const probing = async <T>(run: () => Promise<T>): Promise<T> => {
        const before = host.errors();
        const result = await run();
        if (!before && GPU_TIMER_ERROR.test(host.errors())) {
          host.resetErrors();
          probeTimerErrors++;
        }
        return result;
      };
      host.resetSamples();
      host.startSampling();
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
      });
      try {
        if (settings.motion === 'zoom' || settings.motion === 'biome-sweep') {
          const began = performance.now();
          await zoom(scenario, context);
          motionSeconds = (performance.now() - began) / 1000;
          motionMismatches = settingsMismatches(host.read(), settings);
        } else if (settings.motion === 'sweep') {
          motionSeconds = await sweep(scenario, context);
          motionMismatches = settingsMismatches(host.read(), settings);
        } else if (settings.motion === 'turn') {
          motionSeconds = await turn(scenario, context);
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
        if (settings.motion === 'zoom' || settings.motion === 'biome-sweep') host.setZoomProgress(undefined);
        if (settings.motion === 'sweep') host.setSweepTime(undefined);
        if (settings.motion === 'turn') host.setTurnTime(undefined);
      }
      const selection = [...host.selectionSamples()];
      const selectOnly = [...(host.selectOnlySamples?.() ?? [])];
      const uploadOnly = [...(host.uploadOnlySamples?.() ?? [])];
      const leaves = [...host.leafSamples()];
      const levelChanges = [...host.levelChangeSamples()];
      const levelChangesAll = [...host.levelChangeAllSamples()];
      const info = host.frame();
      const environment = host.environment();
      const expectCracks = crackExpectation(settings);
      // The probe runs after the window, so it never shares a frame with the timing. The zoom ends far from the pose it is
      // named for, so it has none. The sweep's last frame is a view like any other, and its tree carries the splits the
      // hysteresis kept from the swing, which is the tree the probe should see.
      const traversalProbes: (CrackCount & { readonly width: number; readonly height: number })[] = [];
      if (settings.motion === 'biome-sweep') {
        // Replay the trajectory after timing, retaining the path's successive selections without contaminating CPU/GPU samples.
        try {
          for (let i = 0; i <= 16; i++) {
            host.setZoomProgress(i / 16);
            await waitForFrames(host, 2, context);
            if (i % 4 === 0) traversalProbes.push(await probing(() => host.crackProbe()));
          }
        } finally { host.setZoomProgress(undefined); }
      }
      let probe = undefined as (CrackCount & { readonly width: number; readonly height: number }) | undefined;
      await probing(async () => {
        if (settings.motion !== 'zoom' && settings.motion !== 'biome-sweep') probe = await host.crackProbe();
        await waitForFrames(host, 2, context);
      });
      const mismatches = moving ? motionMismatches : settingsMismatches(host.read(), settings);
      const error = host.errors();
      const checks: TestCheck[] = [
        { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(environment['backend']) },
        { name: 'Surface drawn in one draw call', passed: info.instances > 0 && info.drawCalls >= 1, detail: `${info.instances} leaves, ${info.drawCalls} draw calls` },
        {
          name: 'Leaf count within the cap (plus balancing slack)', passed: maxOf(leaves) <= settings.leafCap + CAP_SLACK,
          detail: `most ${maxOf(leaves)} leaves, cap ${settings.leafCap}${info.stats.capHit ? `, cap hit with ${info.stats.unmet} unmet` : ''}`,
        },
        { name: 'No engine or console error', passed: error === '', detail: error || undefined },
      ];
      if (probe) {
        checks.push(expectCracks === 'none'
          ? { name: 'No cracks: no backstop pixel inside the surface', passed: probe.cracks === 0, detail: `${probe.cracks} px of ${probe.width}x${probe.height}` }
          : { name: 'Control: the probe finds the cracks this case makes', passed: probe.cracks > 0, detail: `${probe.cracks} px of ${probe.width}x${probe.height}` });
        checks.push({ name: 'Surface seen by the probe', passed: probe.surface > 0, detail: `${probe.surface} px` });
      }
      if (traversalProbes.length) {
        checks.push({ name: 'No cracks at five traversal positions', passed: traversalProbes.every((p) => p.cracks === 0 && p.surface > 0), detail: traversalProbes.map((p) => p.cracks).join(', ') + ' px' });
      }
      if (moving) {
        checks.push({ name: `No rebuild storm: every frame's selection under ${STORM_MS} ms`, passed: selection.length > 0 && maxOf(selection) < STORM_MS, detail: `most ${maxOf(selection).toFixed(2)} ms over ${selection.length} frames` });
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
          name: 'selectionCpu', unit: 'ms', samples: selection,
          source: 'Main thread, per frame: quadtree rebuild, edge masks and instance upload (performance.now, 0.1 ms steps)',
          unavailableReason: selection.length ? undefined : 'No frame selected in the window',
        },
        ...(selectOnly.length ? [{ name: 'selectorCpu', unit: 'ms', samples: selectOnly, source: 'Camera frustum and selector per frame' } satisfies TestMetric] : []),
        ...(uploadOnly.length ? [{ name: 'instanceUploadCpu', unit: 'ms', samples: uploadOnly, source: 'Instance packing and anchor uniforms per frame' } satisfies TestMetric] : []),
        ...(traversalProbes.length ? [{ name: 'traversalCrackPixels', unit: 'px', samples: traversalProbes.map((p) => p.cracks), source: 'Five positions from 0 to 1 along replayed traversal; probe outside timing window' } satisfies TestMetric] : []),
        { name: 'leaves', unit: 'count', samples: leaves, source: 'Leaves of the selected tree per frame (drawn and culled)' },
        { name: 'drawnLeaves', unit: 'count', samples: [info.instances], source: 'Instances drawn on the last frame' },
        { name: 'surfaceTriangles', unit: 'count', samples: [info.instances * info.trianglesPerLeaf], source: 'Drawn leaves x 2 N^2 on the last frame' },
        { name: 'pixelsPerTriangleUpperBound', unit: 'px/triangle', samples: [info.drawingBuffer[0] * info.drawingBuffer[1] / Math.max(1, info.instances * info.trianglesPerLeaf)], source: 'Canvas device pixels divided by drawn surface triangles, upper bound; last frame' },
        { name: 'drawCalls', unit: 'count', samples: [info.drawCalls], source: 'Renderer draw calls on the last frame' },
        {
          name: 'frameInterval', unit: 'ms', samples: intervals, source: 'Deltas of renderComplete$ timestamps; display-cadence quantized, not GPU time',
          unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed',
        },
        ...GPU_PASS_METRICS.map(({ kind, name, source }): TestMetric => {
          const samples = passes?.byKind[kind]?.samples ?? [];
          return {
            name, unit: 'ms', optional: true, source, samples,
            unavailableReason: samples.length ? undefined : timestampQuery ? 'No per-pass GPU timestamps resolved in the window' : 'No GPU timestamp query on this renderer',
          };
        }),
        ...bakeMetrics(info.bake),
        ...(moving ? levelChangeMetrics(levelChanges, levelChangesAll, motionSeconds) : []),
        ...(probe ? [{ name: 'crackPixels', unit: 'px', samples: [probe.cracks], source: 'Backstop pixels inside the surface, outline-adjacent pixels masked' } satisfies TestMetric] : []),
      ];
      return {
        metrics,
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms, frameVerdict: summary.verdict,
          gpuWholeRenderMedianMs: summary.gpuMedianMs, gpuPassTotalMedianMs: passes ? passes.total.medianMs : null,
          leaves: info.stats.leaves, drawnLeaves: info.instances, splits: info.stats.splits, forcedSplits: info.stats.forcedSplits,
          newSplits: info.stats.newSplits, merges: info.stats.merges, visibleNewSplits: info.stats.visibleNewSplits, visibleMerges: info.stats.visibleMerges, hysteresis: settings.hysteresis,
          unmet: info.stats.unmet, capHit: info.stats.capHit, deepestLevel: info.stats.deepestLevel,
          drawCalls: info.drawCalls, rendererTriangles: info.rendererTriangles,
          drawingBufferWidth: info.drawingBuffer[0], drawingBufferHeight: info.drawingBuffer[1],
          ...(settleTimerErrors > 0 ? { settleTimerErrorsTolerated: settleTimerErrors } : {}),
          ...(probeTimerErrors > 0 ? { probeTimerErrorsTolerated: probeTimerErrors } : {}),
          ...(info.bake ? { bakeSource: info.bake.source, bakeSide: info.bake.side, bakeRoundTripMs: info.bake.roundTripMs, twinErrorMaxM: maxOf(info.bake.twinErrorM), twinErrorP95M: percentile(info.bake.twinErrorM, 0.95) } : {}),
          ...(probe ? { crackPixels: probe.cracks, crackMaskedPixels: probe.masked, probeSurfacePixels: probe.surface, probeWidth: probe.width, probeHeight: probe.height } : {}),
        },
        validityIssues: [
          ...(moving ? [] : summary.invalidReasons),
          ...(!moving && summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in the window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
        ],
        limitations: [
          'The tree is rebuilt from the roots every frame. Distance mode splits at value > 1 and keeps a split node down to 1 / (1 + hysteresis) (0 = one threshold, so pops at it); fixed mode has no hysteresis.',
          'levelChanges counts only nodes that changed between split and merged while on screen in both trees; levelChangesAll adds the nodes that crossed the frustum edge, which change level unseen. Level pops are not blended in M1 (Plan 059 D5).',
          'Draw calls and renderer triangles are the last frame\'s counters; surfaceTriangles counts drawn leaves only.',
          'The crack probe masks backstop pixels next to the background, so a hole on the outline is not counted.',
          'selectionCpu includes the instance upload copy, not the GPU buffer write.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.setZoomProgress(undefined);
      host.setSweepTime(undefined);
      host.setTurnTime(undefined);
      host.apply(snapshot);
      await waitForFrames(host, 2, context);
    },
    environment: () => host.environment(),
    ...(host.thumbnail ? {
      thumbnail: async (scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext) => {
        if (context.repetition > 1 || scenario.settings.motion !== undefined) return undefined;
        const image = await host.thumbnail?.();
        return image ? [image] : undefined;
      },
    } : {}),
  };
}
