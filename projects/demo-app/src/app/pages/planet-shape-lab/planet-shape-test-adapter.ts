import type { GpuPassKind, IGpuPassSummary } from 'triangular-engine';
import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import { featureMismatches } from './planet-shape-features';
import {
  DEPTH_SAMPLE_STRIDE, changedPixels, compareQuality, referenceSphereFrame, surfaceCoordinateErrors, type QualityFrame,
  type QualityProbeCamera,
} from './planet-shape-quality';
import type { PlanetShapeTestSettings } from './planet-shape-tests';

/** What the last completed render drew, from the renderer's own counters (shadow passes included). */
export interface PlanetShapeSceneInfo {
  readonly bodyDrawn: boolean;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly drawingBuffer: readonly [number, number];
}

/** The engine's `FrameSampler` summary, as far as this adapter reads it. */
export interface PlanetShapeFrameSummary {
  readonly frames: number;
  readonly cpuMedianMs: number;
  readonly cpuP95Ms: number;
  readonly wallMedianMs: number;
  readonly wallP95Ms: number;
  readonly gpuMedianMs: number | null;
  readonly gpuSamples: number;
  readonly invalidReasons: readonly string[];
  readonly verdict: string;
  /** GPU ms split by render pass, with the timer self-test; absent or `null` without per-pass timestamps. */
  readonly gpuPasses?: IGpuPassSummary | null;
}

/**
 * The per-pass GPU metrics, in the terms of plan 055. WebGPU times passes, not meshes, and in this lab only the body
 * draws into the scene pass and casts into the shadow map, so the scene pass is the terrain and the shadow passes are
 * the terrain shadows. The output pass (tone mapping, colour space) is everything else.
 */
const GPU_PASS_METRICS: readonly { readonly kind: GpuPassKind; readonly name: string; readonly source: string; readonly absent: string }[] = [
  {
    kind: 'scene', name: 'gpuScenePass',
    source: 'WebGPU timestamps of the main scene pass, per frame: the terrain here (the body is the only mesh), plus clear',
    absent: 'No scene pass was timed',
  },
  {
    kind: 'shadow', name: 'gpuShadowPasses',
    source: 'WebGPU timestamps of the shadow-map passes, summed per frame: the terrain shadows (only the body casts)',
    absent: 'No shadow pass rendered (shadows feature off)',
  },
  {
    kind: 'output', name: 'gpuOutputPass',
    source: 'WebGPU timestamps of the renderer output pass (tone mapping, colour space): everything else',
    absent: 'No output pass was timed',
  },
];

function passLabels(passes: IGpuPassSummary): string {
  return Object.entries(passes.byLabel).map(([label, stat]) => `${label}: ${stat.medianMs.toFixed(4)} ms`).join('; ');
}

/** Two offscreen frames of the current view from the quality probe, with the camera and body they were drawn for. */
export interface PlanetShapeQualityProbe {
  readonly frames: readonly [QualityFrame, QualityFrame];
  readonly camera: QualityProbeCamera;
  readonly radiusM: number;
  /** Width/height segments of the drawn sphere, so the reference can rebuild its triangles. */
  readonly segments: { readonly width: number; readonly height: number };
}

/** What the lab page offers the adapter: its normal actions plus read-only probes. Implemented by the page. */
export interface PlanetShapeTestHost {
  /** The full state a run changes; also the snapshot a run restores. */
  read(): PlanetShapeTestSettings;
  /** Applies a scenario through the page's own setters. Synchronous. */
  apply(settings: PlanetShapeTestSettings): void;
  renderedFrames(): number;
  /** First engine or console error since `resetErrors`, or ''. */
  errors(): string;
  resetErrors(): void;
  backendIsWebGpu(): boolean;
  scene(): PlanetShapeSceneInfo;
  onBeforeRender(callback: () => void): () => void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  isSampling(): boolean;
  startSampling(): void;
  /** Whole-render GPU ms of the open sampling window so far; empty without timestamp queries. */
  gpuSamplesSoFar(): readonly number[];
  stopSampling(): PlanetShapeFrameSummary;
  environment(): Readonly<Record<string, TestSetting>>;
  /**
   * A small picture of the current view, for the results page (the page uses `ScreenshotService` on its fast path, so the
   * renderer is not resized). Optional: a host without it gets no thumbnails. Only called after a measurement.
   */
  thumbnail?(): Promise<Blob | undefined>;
  /** Draws the current view twice into the quality probe's float target and reads both back. Optional: WebGPU pages only. */
  qualityProbe?(): Promise<PlanetShapeQualityProbe>;
}

const READY_TIMEOUT_MS = 60_000;
const STALL_MS = 5_000;
const MIN_WINDOW_FRAMES = 60;
const SETTLE_FRAMES = 3;
/** `performance.now()` is coarsened to 0.1 ms in this browser setup; smaller changes are timer noise. */
const TIMER_STEP_MS = 0.1;
/** GPU timestamps with the developer flag step at about 1 µs. */
const GPU_STEP_MS = 0.001;

/** Names every field the page did not honour; the spin angle advances on its own and is not compared. */
export function settingsMismatches(actual: PlanetShapeTestSettings, expected: PlanetShapeTestSettings): string[] {
  const out: string[] = [];
  for (const key of ['kind', 'seed', 'bodyId', 'poseId', 'spinWarp', 'morph'] as const) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
  }
  return [...out, ...featureMismatches(actual.features, expected.features)];
}

async function waitForFrames(host: PlanetShapeTestHost, count: number, context: TestContext): Promise<void> {
  const start = host.renderedFrames();
  const began = performance.now();
  while (host.renderedFrames() < start + count) {
    if (performance.now() - began > STALL_MS) throw new Error(`No frame rendered for ${STALL_MS} ms`);
    await context.wait(16);
  }
}

const max = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

/**
 * Plan 055 quality metrics of the current view against the exact sphere (`planet-shape-quality.ts`). A correctness case:
 * no timing window, and the numbers are the same on any GPU that draws the same triangles.
 */
async function measureQuality(host: PlanetShapeTestHost, scenario: TestScenario<PlanetShapeTestSettings>, context: TestContext): Promise<TestObservation> {
  if (!host.qualityProbe) throw new Error('This page has no quality probe');
  await waitForFrames(host, 2, context);
  const probe = await host.qualityProbe();
  const [frame, again] = probe.frames;
  const reference = referenceSphereFrame(probe.camera, probe.radiusM, frame.width, frame.height);
  const result = compareQuality(frame, reference);
  const flicker = changedPixels(frame, again);
  const surface = surfaceCoordinateErrors(frame, probe.camera, probe.radiusM, probe.segments);
  const settings = scenario.settings;
  const mismatches = settingsMismatches(host.read(), settings);
  const error = host.errors();
  const checks: TestCheck[] = [
    { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
    { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(host.environment()['backend']) },
    // The reference is the sphere itself; a morphed surface is a different shape.
    { name: 'Unmorphed (the reference is the sphere)', passed: settings.morph === 0, detail: `morph ${settings.morph}` },
    { name: 'Reference sees the planet', passed: result.drawnReference > 0, detail: `${result.drawnReference} px` },
    { name: 'Planet drawn in the probe', passed: result.drawnProbe > 0, detail: `${result.drawnProbe} px` },
    { name: 'No cracks: no undrawn pixel enclosed by the surface', passed: result.cracks === 0, detail: `${result.cracks} px` },
    { name: 'No flicker: two frames at a still pose match', passed: flicker === 0, detail: `${flicker} px differ` },
    { name: 'No engine or console error', passed: error === '', detail: error || undefined },
  ];
  const metrics: TestMetric[] = [
    {
      name: 'silhouetteErrorPx', unit: 'px', samples: result.silhouetteErrorPx,
      source: `Per column of the ${frame.width}x${frame.height} probe: |drawn pixels - drawn pixels of the exact sphere| (columns where either draws)`,
      unavailableReason: result.silhouetteErrorPx.length ? undefined : 'Nothing drawn in either frame',
    },
    {
      name: 'depthErrorM', unit: 'm', samples: result.depthErrorM,
      source: `|probe distance - exact sphere distance| from the camera, every ${DEPTH_SAMPLE_STRIDE} px where both draw`,
      unavailableReason: result.depthErrorM.length ? undefined : 'No pixel drawn in both frames',
    },
    {
      name: 'depthErrorRelative', unit: 'ratio', samples: result.depthErrorRelative,
      source: 'depthErrorM divided by the exact distance, same pixels',
      unavailableReason: result.depthErrorRelative.length ? undefined : 'No pixel drawn in both frames',
    },
    { name: 'cracks', unit: 'px', samples: [result.cracks], source: 'Undrawn probe pixels cut off from the image border by drawn ones' },
    { name: 'flickerPixels', unit: 'px', samples: [flicker], source: 'Pixels whose drawn flag or distance differ between two probe frames of the same pose' },
    {
      name: 'surfaceCoordErrorM', unit: 'm', samples: surface.errorsM,
      source: `|GPU uv - exact uv on the same triangle| in metres of ground, every ${DEPTH_SAMPLE_STRIDE} px where the probe draws`,
      unavailableReason: surface.errorsM.length ? undefined : 'No drawn pixel with a matching triangle',
    },
  ];
  return {
    metrics,
    checks,
    details: {
      probeWidth: frame.width, probeHeight: frame.height, drawnProbe: result.drawnProbe, drawnReference: result.drawnReference,
      silhouetteErrorMaxPx: max(result.silhouetteErrorPx), depthErrorMaxM: max(result.depthErrorM),
      depthErrorMaxRelative: max(result.depthErrorRelative), radiusM: probe.radiusM, fovDeg: probe.camera.fovDeg,
      surfaceCoordErrorMaxM: max(surface.errorsM), surfaceCoordUnmatched: surface.unmatched,
    },
    validityIssues: [],
    limitations: [
      "The reference is the exact sphere, so the errors include the plain sphere's own tessellation (512 x 256, inscribed): they are the floor a contender is compared with, not a fault.",
      `The probe is ${frame.width}x${frame.height} (half the reference drawing buffer); silhouette pixels are probe pixels.`,
      'Depth is the distance from the camera, written in float32 by the probe material: about 7 significant digits.',
      'A crack that reaches the silhouette is not counted as a crack; it shows in the silhouette error.',
      'surfaceCoordErrorM compares with the exact uv on the drawn triangle, not the true sphere: it is the float32 precision of the surface coordinates (what a checker edge or texture lookup shows), not facet shape.',
      'Not measured yet (need terrain or a collider): popping during a slow zoom, per-fidelity-class metrics, collider parity.',
    ],
  };
}

/**
 * Game-owned adapter for the planet shape lab. All page knowledge sits behind {@link PlanetShapeTestHost}; the shared
 * runner only sees settings, observations and snapshots.
 */
export function createPlanetShapeTestAdapter(host: PlanetShapeTestHost): TestRunAdapter<PlanetShapeTestSettings, PlanetShapeTestSettings> {
  async function waitSettled(scenario: TestScenario<PlanetShapeTestSettings>, context: TestContext): Promise<void> {
    const began = performance.now();
    let settled = 0;
    let lastFrame = host.renderedFrames();
    while (true) {
      const error = host.errors();
      if (error) throw new Error(error);
      const frame = host.renderedFrames();
      const mismatches = settingsMismatches(host.read(), scenario.settings);
      if (mismatches.length > 0) settled = 0;
      else if (frame > lastFrame) settled++;
      lastFrame = frame;
      if (settled >= SETTLE_FRAMES) return;
      if (performance.now() - began > READY_TIMEOUT_MS) {
        throw new Error(`Lab not settled after ${READY_TIMEOUT_MS / 1000} s: ${mismatches.join('; ') || 'no frames rendered'}`);
      }
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
      if (scenario.settings.probe === 'quality') return measureQuality(host, scenario, context);
      if (host.isSampling()) throw new Error('Another frame sampling window is already active');
      const intervals: number[] = [];
      const submit: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let beforeAt: number | undefined;
      let summary: PlanetShapeFrameSummary;
      host.startSampling();
      const offBefore = host.onBeforeRender(() => { beforeAt = performance.now(); });
      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) intervals.push(renderedAt - previousAt);
        previousAt = renderedAt;
        if (beforeAt !== undefined) submit.push(renderedAt - beforeAt);
      });
      try {
        // Quick mode stops once frame pacing, submit time and (with timestamps) GPU time have settled.
        await context.measureWindow(scenario, [
          { name: 'frameInterval', samples: () => intervals, resolution: TIMER_STEP_MS },
          { name: 'renderSubmitCpu', samples: () => submit, resolution: TIMER_STEP_MS },
          ...(host.environment()['gpu.timestampQuery'] === true
            ? [{ name: 'gpuFrame', samples: () => host.gpuSamplesSoFar(), resolution: GPU_STEP_MS }] : []),
        ]);
        summary = host.stopSampling();
      } finally {
        offBefore();
        offRender();
        if (host.isSampling()) host.stopSampling();
      }
      const settings = scenario.settings;
      const info = host.scene();
      const environment = host.environment();
      const mismatches = settingsMismatches(host.read(), settings);
      const error = host.errors();
      const expectDrawn = settings.kind === 'sphere';
      const checks: TestCheck[] = [
        { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
        { name: 'Frames rendered during the action', passed: frames >= 2, detail: `${frames} completed renders` },
        { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(environment['backend']) },
        // The renderer's output pass (colour space, tone mapping) draws one full-screen triangle even in an empty frame.
        { name: expectDrawn ? 'Planet drawn' : 'Planet not drawn', passed: info.bodyDrawn === expectDrawn && (expectDrawn ? info.drawCalls > 0 : info.drawCalls <= 1),
          detail: `${info.drawCalls} draw calls, ${info.triangles} triangles` },
        { name: 'Drawing buffer reported', passed: info.drawingBuffer[0] > 0 && info.drawingBuffer[1] > 0, detail: `${info.drawingBuffer[0]}x${info.drawingBuffer[1]}` },
        { name: 'No engine or console error', passed: error === '', detail: error || undefined },
      ];
      const passes = summary.gpuPasses ?? null;
      if (passes) {
        // The timer self-test: every timestamp belongs to a pass of the frame it claims, no frame is cut short, the
        // passes add up to the Three.js frame total, and the timestamps are not rounded.
        checks.push({
          name: 'GPU timer self-test', passed: passes.selfTest.passed,
          detail: passes.selfTest.issues.join('; ')
            || `${passes.frames} frames in ${passes.selfTest.batches} readbacks, timestamp step ${passes.resolution.resolutionNs} ns`,
        });
      }
      const software = environment['gpu.software'] === true;
      const timestampQuery = environment['gpu.timestampQuery'] === true;
      const metrics: TestMetric[] = [
        {
          name: 'frameInterval', unit: 'ms', source: 'Deltas of engine renderComplete$ timestamps (performance.now); display-cadence quantized, not GPU time',
          samples: intervals, unavailableReason: intervals.length ? undefined : 'Fewer than two frames completed in the window',
        },
        {
          name: 'renderSubmitCpu', unit: 'ms', source: 'beforeRender$ to renderComplete$ on the main thread: command encoding and submit, not GPU execution',
          samples: submit, unavailableReason: submit.length ? undefined : 'No frame completed in the window',
        },
        ...GPU_PASS_METRICS.map(({ kind, name, source, absent }): TestMetric => {
          const samples = passes?.byKind[kind]?.samples ?? [];
          const unavailableReason = samples.length ? undefined
            : !passes ? (timestampQuery ? 'No per-pass GPU timestamps were resolved in the window' : 'No GPU timestamp query on this renderer')
            : absent;
          return { name, unit: 'ms', optional: true, source, samples, unavailableReason };
        }),
        {
          name: 'gpuPassTotal', unit: 'ms', optional: true,
          source: 'WebGPU timestamps of every timed pass of a frame, summed per complete frame: what an A/B of a feature compares',
          samples: passes?.total.samples ?? [],
          unavailableReason: passes ? undefined : timestampQuery ? 'No per-pass GPU timestamps were resolved in the window' : 'No GPU timestamp query on this renderer',
        },
      ];
      return {
        metrics,
        checks,
        details: {
          frames: summary.frames, cpuMedianMs: summary.cpuMedianMs, cpuP95Ms: summary.cpuP95Ms,
          wallMedianMs: summary.wallMedianMs, wallP95Ms: summary.wallP95Ms, frameVerdict: summary.verdict,
          gpuWholeRenderMedianMs: summary.gpuMedianMs, gpuWholeRenderSamples: summary.gpuSamples,
          gpuPassFrames: passes?.frames ?? 0, gpuPassTotalMedianMs: passes ? passes.total.medianMs : null,
          gpuTimestampStepNs: passes?.resolution.resolutionNs ?? null, gpuPassLabels: passes ? passLabels(passes) : null,
          drawCalls: info.drawCalls, triangles: info.triangles,
          drawingBufferWidth: info.drawingBuffer[0], drawingBufferHeight: info.drawingBuffer[1],
        },
        validityIssues: [
          ...summary.invalidReasons,
          ...(summary.frames < MIN_WINDOW_FRAMES ? [`Fewer than ${MIN_WINDOW_FRAMES} rendered frames in measurement window`] : []),
          ...(software ? ['Software renderer: functional evidence only, not hardware performance'] : []),
          ...(!passes && timestampQuery && !software ? ['No per-pass GPU timestamps were resolved in the window'] : []),
        ],
        limitations: [
          'Diagnostic timings; no controlled-machine profile, preflight gate or accepted baseline comparison yet.',
          'Draw calls and triangles come from the renderer counters of the last frame and include shadow passes.',
          'The plain sphere is an inscribed polyhedron (512 x 256 segments): a ground view stands above a flat facet, not a curved surface.',
          'GPU time is per render pass, not per mesh: the scene pass includes its clear, so compare it against the empty frame.',
          'Per-pass medians come from complete frames only and need not add up to the whole-render median, which samples fewer frames.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      host.apply(snapshot);
      await waitForFrames(host, 2, context);
    },
    environment: () => host.environment(),
    // One still per scenario, from the first repetition: later ones look at the same view. Taken by the session after
    // `measure`, never inside the window.
    ...(host.thumbnail ? {
      thumbnail: async (_: TestScenario<PlanetShapeTestSettings>, context: TestContext) => {
        if (context.repetition > 1) return undefined;
        const image = await host.thumbnail?.();
        return image ? [image] : undefined;
      },
    } : {}),
  };
}
