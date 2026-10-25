import type { GpuPassKind, IFrameSampleSummary } from 'triangular-engine';
import { modeActionMs, type TestCheck, type TestContext, type TestMetric, type TestObservation, type TestRunAdapter, type TestScenario, type TestSetting } from 'triangular-engine/testing';
import type { CrackCount } from './lod-crack-probe';
import { CAP_SLACK, type SelectorStats } from './lod-selector';
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
  frame(): LodSurfaceFrameInfo;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  /** Main-thread ms of selection plus instance upload, one sample per frame since the last reset. */
  selectionSamples(): readonly number[];
  /** Leaves per frame since the last reset (same frames as {@link selectionSamples}). */
  leafSamples(): readonly number[];
  resetSamples(): void;
  /** Places the camera on the scripted zoom (0 eye, 1 orbit); `undefined` returns to the named pose. */
  setZoomProgress(t: number | undefined): void;
  isSampling(): boolean;
  startSampling(): void;
  gpuSamplesSoFar(): readonly number[];
  stopSampling(): IFrameSampleSummary;
  crackProbe(): Promise<CrackCount & { readonly width: number; readonly height: number }>;
  environment(): Readonly<Record<string, TestSetting>>;
  thumbnail?(): Promise<Blob | undefined>;
}

const READY_TIMEOUT_MS = 30_000;
const STALL_MS = 5_000;
const SETTLE_FRAMES = 3;
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
  ];
}

const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

export function createLodSurfaceTestAdapter(host: LodSurfaceTestHost): TestRunAdapter<LodSurfaceTestSettings, LodSurfaceTestSettings> {
  async function waitSettled(scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext): Promise<void> {
    const began = performance.now();
    let settled = 0;
    let lastFrame = host.renderedFrames();
    while (settled < SETTLE_FRAMES) {
      const error = host.errors();
      if (error) throw new Error(error);
      const frame = host.renderedFrames();
      const mismatches = settingsMismatches(host.read(), scenario.settings);
      if (host.heightSourceReady?.() === false) settled = 0;
      else if (mismatches.length > 0) settled = 0;
      else if (frame > lastFrame) settled++;
      lastFrame = frame;
      if (performance.now() - began > READY_TIMEOUT_MS) {
        throw new Error(`Lab not settled after ${READY_TIMEOUT_MS / 1000} s: ${mismatches.join('; ') || 'no frames rendered'}`);
      }
      await context.wait(16);
    }
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
      // The zoom clears its own motion when it ends, so its state is checked while it still runs.
      let zoomMismatches: string[] = [];
      host.resetSamples();
      host.startSampling();
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
      });
      try {
        if (settings.motion === 'zoom') {
          await zoom(scenario, context);
          zoomMismatches = settingsMismatches(host.read(), settings);
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
        if (settings.motion === 'zoom') host.setZoomProgress(undefined);
      }
      const selection = [...host.selectionSamples()];
      const leaves = [...host.leafSamples()];
      const info = host.frame();
      const environment = host.environment();
      const expectCracks = crackExpectation(settings);
      // The probe runs after the window, so it never shares a frame with the timing.
      const probe = settings.motion === 'zoom' ? undefined : await host.crackProbe();
      await waitForFrames(host, 2, context);
      const mismatches = settings.motion === 'zoom' ? zoomMismatches : settingsMismatches(host.read(), settings);
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
      if (settings.motion === 'zoom') {
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
        { name: 'leaves', unit: 'count', samples: leaves, source: 'Leaves of the selected tree per frame (drawn and culled)' },
        { name: 'drawnLeaves', unit: 'count', samples: [info.instances], source: 'Instances drawn on the last frame' },
        { name: 'surfaceTriangles', unit: 'count', samples: [info.instances * info.trianglesPerLeaf], source: 'Drawn leaves x 2 N^2 on the last frame' },
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
        ...(probe ? [{ name: 'crackPixels', unit: 'px', samples: [probe.cracks], source: 'Backstop pixels inside the surface, outline-adjacent pixels masked' } satisfies TestMetric] : []),
      ];
      return {
        metrics,
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms, frameVerdict: summary.verdict,
          gpuWholeRenderMedianMs: summary.gpuMedianMs, gpuPassTotalMedianMs: passes ? passes.total.medianMs : null,
          leaves: info.stats.leaves, drawnLeaves: info.instances, splits: info.stats.splits, forcedSplits: info.stats.forcedSplits,
          unmet: info.stats.unmet, capHit: info.stats.capHit, deepestLevel: info.stats.deepestLevel,
          drawCalls: info.drawCalls, rendererTriangles: info.rendererTriangles,
          drawingBufferWidth: info.drawingBuffer[0], drawingBufferHeight: info.drawingBuffer[1],
          ...(info.bake ? { bakeSource: info.bake.source, bakeSide: info.bake.side, bakeRoundTripMs: info.bake.roundTripMs } : {}),
          ...(probe ? { crackPixels: probe.cracks, crackMaskedPixels: probe.masked, probeSurfacePixels: probe.surface, probeWidth: probe.width, probeHeight: probe.height } : {}),
        },
        validityIssues: [
          ...(settings.motion === 'zoom' ? [] : summary.invalidReasons),
          ...(settings.motion !== 'zoom' && summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in the window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
        ],
        limitations: [
          'M1 rebuilds the tree from the roots every frame (no hysteresis): level pops are allowed and labelled in M1.',
          'Draw calls and renderer triangles are the last frame\'s counters; surfaceTriangles counts drawn leaves only.',
          'The crack probe masks backstop pixels next to the background, so a hole on the outline is not counted.',
          'selectionCpu includes the instance upload copy, not the GPU buffer write.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.setZoomProgress(undefined);
      host.apply(snapshot);
      await waitForFrames(host, 2, context);
    },
    environment: () => host.environment(),
    ...(host.thumbnail ? {
      thumbnail: async (scenario: TestScenario<LodSurfaceTestSettings>, context: TestContext) => {
        if (context.repetition > 1 || scenario.settings.motion === 'zoom') return undefined;
        const image = await host.thumbnail?.();
        return image ? [image] : undefined;
      },
    } : {}),
  };
}
