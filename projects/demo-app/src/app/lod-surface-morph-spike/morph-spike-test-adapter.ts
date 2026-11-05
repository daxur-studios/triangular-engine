import type { GpuPassKind, IFrameSampleSummary } from 'triangular-engine';
import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import type { CrackCase, ILodSurfaceMorphSpikeDiagnostics, CrackProbeOptions, CrackRow, FanProbeOptions, FanProbeRow, FanRebuildOptions, FanRebuildRow, MorphSpikeState, ProbeOptions, ProbeResult } from './core';
import {
  crackObservation, fanPrecisionObservation, fanProbeOptionsOf, fanRebuildObservation, precisionObservation, type MorphSpikeTestSettings,
} from './morph-spike-tests';

/** The page as the adapter sees it: the spike's own handles, nothing else. */
export interface MorphSpikeTestHost {
  /** The spike's state (`getState`). */
  read(): MorphSpikeState;
  /** Sets the spike's state (`setState`). */
  apply(patch: Partial<MorphSpikeState>): void;
  /** True once the scene has drawn a frame, so a probe has a renderer, a camera and a compiled pipeline to work with. */
  ready(): boolean;
  backendIsWebGpu(): boolean;
  runProbe(options: ProbeOptions): Promise<ProbeResult[]>;
  runCrackProbe(options: CrackProbeOptions): Promise<CrackRow[]>;
  /** The vertex-stage pole fan's precision probe (v6). */
  runFanProbe(options: FanProbeOptions): Promise<FanProbeRow[]>;
  /** The scripted camera move and morph change that counts the pole fan's rebuilds (v6). */
  runFanRebuild(options: FanRebuildOptions): Promise<FanRebuildRow[]>;
  environment(): Readonly<Record<string, TestSetting>>;
  /** Frames the scene has completed since the page started (v7 frame-cost cases). */
  renderedFrames(): number;
  /** The scene's last diagnostics: leaves, instances, triangles, draw calls and the pole fan's cost. */
  frame(): ILodSurfaceMorphSpikeDiagnostics | undefined;
  /** The engine's frame sampler and render-complete event, as the planet-scene page uses them. */
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  startSampling(): void;
  stopSampling(): IFrameSampleSummary;
  isSampling(): boolean;
  gpuSamplesSoFar(): readonly number[];
}

const SETTLE_FRAMES = 90;
const SETTLE_TIMEOUT_MS = 60_000;
const MIN_WINDOW_FRAMES = 60;
const TIMER_STEP_MS = 0.1;
const GPU_STEP_MS = 0.001;
const GPU_PASS_METRICS: readonly { kind: GpuPassKind; name: string; source: string }[] = [
  { kind: 'scene', name: 'gpuScenePass', source: 'WebGPU timestamps, summed per frame over every pass the timer labels `scene`' },
  { kind: 'output', name: 'gpuOutputPass', source: 'WebGPU timestamps of the renderer output pass' },
];

const READY_TIMEOUT_MS = 30_000;
const THUMBNAIL_WIDTH_PX = 320;
const THUMBNAIL_QUALITY = 0.6;

/** The probe image a thumbnail is made from: the one case of a scenario that shows the most. */
interface KeptImage {
  readonly score: number;
  readonly c: CrackCase;
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** The case a scenario's still is taken of: a real case at morph 0.5, the pole edge first. */
export function thumbnailScore(c: CrackCase): number {
  if (c.control) return 0;
  return 1 + (c.morph === 0.5 ? 2 : 0) + (c.view === 'pole-200m' ? 4 : 0);
}

/** Draws a probe image (row 0 on top unless `flipY`) into a small WebP. Undefined where the browser has no canvas encoder. */
async function imageBlob(image: KeptImage, flipY: boolean): Promise<Blob | undefined> {
  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  const fullContext = full.getContext('2d');
  if (!fullContext) return undefined;
  fullContext.putImageData(new ImageData(image.rgba as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  const small = document.createElement('canvas');
  small.width = THUMBNAIL_WIDTH_PX;
  small.height = Math.max(1, Math.round((THUMBNAIL_WIDTH_PX * image.height) / image.width));
  const smallContext = small.getContext('2d');
  if (!smallContext) return undefined;
  if (flipY) {
    smallContext.translate(0, small.height);
    smallContext.scale(1, -1);
  }
  smallContext.drawImage(full, 0, 0, small.width, small.height);
  return new Promise<Blob | undefined>((resolve) => small.toBlob((blob) => resolve(blob ?? undefined), 'image/webp', THUMBNAIL_QUALITY));
}

/**
 * The testing adapter of the morph spike. A case runs one of the page's probes with the scenario's settings and turns its rows into
 * checks and count metrics (`morph-spike-tests.ts`). The probes render into their own target and pause the page's frame, so there
 * is no timed window: `windowModes` is off and the case is functional evidence.
 */
export function createMorphSpikeTestAdapter(host: MorphSpikeTestHost): TestRunAdapter<MorphSpikeTestSettings, MorphSpikeState> {
  const keep: { image?: KeptImage } = {};
  let keptRows: readonly CrackRow[] = [];

  /** Waits for the scene to draw `SETTLE_FRAMES` frames with the leaf count steady, so the selector has settled on the case's state. */
  async function settle(context: TestContext): Promise<void> {
    const began = performance.now();
    let settled = 0;
    let lastFrame = host.renderedFrames();
    let lastLeaves = -1;
    while (settled < SETTLE_FRAMES) {
      if (performance.now() - began > SETTLE_TIMEOUT_MS) throw new Error(`Scene not settled after ${SETTLE_TIMEOUT_MS / 1000} s`);
      await context.wait(16);
      const frame = host.renderedFrames();
      if (frame === lastFrame) continue;
      const leaves = host.frame()?.leaves ?? -1;
      settled = leaves === lastLeaves ? settled + (frame - lastFrame) : 0;
      lastLeaves = leaves;
      lastFrame = frame;
    }
  }

  async function measureFrameCost(scenario: TestScenario<MorphSpikeTestSettings>, context: TestContext): Promise<TestObservation> {
    if (host.isSampling()) throw new Error('Another frame sampling window is already active');
    const settings = scenario.settings;
    const intervals: number[] = [];
    let previousAt: number | undefined;
    host.startSampling();
    const offRender = host.onRenderComplete((renderedAt) => {
      if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
      previousAt = renderedAt;
    });
    let summary: IFrameSampleSummary;
    try {
      const hasTimestamps = host.environment()['gpu.timestampQuery'] === true;
      await context.measureWindow(scenario, [
        { name: 'frameInterval', samples: () => intervals, resolution: TIMER_STEP_MS },
        ...(hasTimestamps ? [{ name: 'gpuFrame', samples: () => host.gpuSamplesSoFar(), resolution: GPU_STEP_MS }] : []),
      ]);
      summary = host.stopSampling();
    } finally {
      offRender();
      if (host.isSampling()) host.stopSampling();
    }
    const info = host.frame();
    const state = host.read();
    const environment = host.environment();
    const expected = { radiusM: settings.radii[0], morph: settings.morphs[0], poseId: settings.views[0] };
    const mismatch = (Object.keys(expected) as (keyof typeof expected)[]).filter((k) => state[k] !== expected[k]).map((k) => `${k}: expected ${expected[k]}, found ${state[k]}`);
    const passes = summary.gpuPasses ?? null;
    const timestampQuery = environment['gpu.timestampQuery'] === true;
    const software = environment['gpu.software'] === true;
    const checks: TestCheck[] = [
      { name: 'Scenario state applied as specified', passed: mismatch.length === 0, detail: mismatch.join('; ') || undefined },
      { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(environment['backend'] ?? 'unknown') },
      { name: 'The scene drew leaves', passed: (info?.leaves ?? 0) > 0, detail: info ? `${info.leaves} leaves, ${info.instances} instances` : 'no diagnostics' },
      ...(passes ? [{ name: 'GPU timer self-test', passed: passes.selfTest.passed, detail: passes.selfTest.issues.join('; ') || `${passes.frames} frames` } satisfies TestCheck] : []),
    ];
    const count = (name: string, source: string, value: number | undefined): TestMetric => ({
      name, unit: 'count', source, samples: value === undefined ? [] : [value], optional: true, unavailableReason: value === undefined ? 'No diagnostics' : undefined,
    });
    const metrics: TestMetric[] = [
      count('leaves', 'Leaves the terrain drew on the last frame', info?.leaves),
      count('instances', 'Instances drawn (leaves plus the second instance of each leaf at the cut)', info?.instances),
      count('surfaceTriangles', 'Triangles of the last frame (the renderer counter: surface, pole fan and anything else drawn)', info?.triangles),
      count('drawCalls', 'Renderer draw calls on the last frame', info?.drawCalls),
      count('deepestLevel', 'Deepest level of the selected tree', info?.deepestLevel),
      count('fanTriangles', 'Triangles of the pole fan on the last frame', info?.fanTriangles),
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
        name: 'gpuPassTotal', unit: 'ms', optional: true, source: 'WebGPU timestamps, all passes of a frame summed', samples: passes?.total.samples ?? [],
        unavailableReason: passes ? undefined : timestampQuery ? 'No per-pass GPU timestamps resolved in the window' : 'No GPU timestamp query on this renderer',
      },
    ];
    return {
      metrics,
      checks,
      details: {
        gpuAdapter: String(environment['gpu.description'] ?? 'unknown'), frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, frameVerdict: summary.verdict,
        drawingBufferWidth: Number(environment['canvas.drawingBufferWidth'] ?? 0), drawingBufferHeight: Number(environment['canvas.drawingBufferHeight'] ?? 0),
      },
      validityIssues: [
        ...summary.invalidReasons,
        ...(summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in the window`] : []),
        ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
      ],
      limitations: [
        "Evidence, not a gate: the spike has no frame budget. The numbers are the morph spike's own surface (stretch metric, vertex-stage pole fan, flat colour) with no atmosphere, sky or lighting; compare with the planet-scene suite for the same morph.",
        'The drawing buffer is whatever size the page opened at; read drawingBufferWidth and drawingBufferHeight before comparing with another run.',
      ],
    };
  }

  return {
    windowModes: true,
    capture: () => host.read(),
    apply: (scenario) => {
      keep.image = undefined;
      keptRows = [];
      if (scenario.settings.kind === 'frame-cost') {
        const f = scenario.settings;
        host.apply({
          radiusM: f.radii[0], morph: f.morphs[0], poseId: f.views[0], lodMetric: f.lodMetric, centreLonDeg: f.centreLonDeg, centreLatDeg: f.centreLatDeg,
          poleFan: f.poleFan ?? false, fanMode: f.fanMode ?? 'vertex', fanRays: f.fanRays ?? 1024, leafCap: f.leafCap ?? 4096, wireframe: false,
        });
        return;
      }
      // The probes put each case's centre and metric in place themselves; setting them here only shows the page the case that runs.
      if (scenario.settings.kind === 'crack') {
        host.apply({ lodMetric: scenario.settings.lodMetric, centreLonDeg: scenario.settings.centreLonDeg, centreLatDeg: scenario.settings.centreLatDeg });
      }
    },
    ready: async (context: TestContext) => {
      const began = performance.now();
      while (!host.ready()) {
        if (performance.now() - began > READY_TIMEOUT_MS) throw new Error(`The scene drew no frame in ${READY_TIMEOUT_MS / 1000} s`);
        await context.wait(50);
      }
    },
    measure: async (scenario, context) => {
      const settings = scenario.settings;
      if (settings.kind === 'frame-cost') {
        await settle(context);
        return measureFrameCost(scenario, context);
      }
      const backend = { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(host.environment()['backend'] ?? 'unknown') };
      if (settings.kind === 'precision') {
        const rows = await host.runProbe({ radii: settings.radii, morphs: settings.morphs, poses: settings.views });
        const observation = precisionObservation(rows);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      if (settings.kind === 'fan-precision') {
        const rows = await host.runFanProbe(fanProbeOptionsOf(settings));
        const observation = fanPrecisionObservation(rows, settings);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      if (settings.kind === 'fan-rebuild') {
        const rows = await host.runFanRebuild({
          radii: settings.radii, centres: settings.fanCentres, modes: settings.fanModes, rays: settings.fanRays, frames: settings.rebuildFrames,
        });
        const observation = fanRebuildObservation(rows, settings);
        return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
      }
      keep.image = undefined;
      const rows = await host.runCrackProbe({
        radii: settings.radii, morphs: settings.morphs, views: settings.views, widthPx: settings.widthPx,
        centreLonDeg: settings.centreLonDeg, centreLatDeg: settings.centreLatDeg, lodMetric: settings.lodMetric,
        matrix: settings.matrix, controls: settings.controls, leafCap: settings.leafCap, diagnosePole: settings.diagnosePole,
        poleFan: settings.poleFan, fanRays: settings.fanRays, fanMode: settings.fanMode,
        onImage: (c, rgba, width, height) => {
          const score = thumbnailScore(c);
          if (score > (keep.image?.score ?? 0)) keep.image = { score, c, rgba: Uint8ClampedArray.from(rgba), width, height };
        },
      });
      keptRows = rows;
      const observation = crackObservation(rows, settings);
      return { ...observation, checks: [backend, ...(observation.checks ?? [])] };
    },
    restore: async (snapshot, context) => {
      host.apply(snapshot);
      await context.wait(32);
    },
    environment: () => host.environment(),
    thumbnail: async (_scenario: TestScenario<MorphSpikeTestSettings>, context: TestContext) => {
      const image = keep.image;
      if (!image || context.repetition > 1) return undefined;
      const row = keptRows.find((r) => r.radiusM === image.c.radiusM && r.view === image.c.view && r.morph === image.c.morph && r.control === image.c.control);
      const blob = await imageBlob(image, row?.flipY ?? false);
      return blob ? [blob] : undefined;
    },
  };
}
