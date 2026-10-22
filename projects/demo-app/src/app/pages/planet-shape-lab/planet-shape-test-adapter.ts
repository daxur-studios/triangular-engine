import type { GpuPassKind, IGpuPassSummary } from 'triangular-engine';
import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import { featureMismatches } from './planet-shape-features';
import {
  DEPTH_SAMPLE_STRIDE, changedPixels, compareQuality, referenceSphereFrame, surfaceCoordinateErrors, type QualityFrame,
  type QualityProbeCamera,
} from './planet-shape-quality';
import {
  BEHIND_FOOTPRINTS, CPU_CHECK_GRID, EDGE_PIXELS, OFF_SURFACE_FOOTPRINTS, TERRAIN_SAMPLE_STRIDE, checkReferenceOnCpu, compareTerrainDepth, labFieldCpu,
  type TerrainDepthFrame,
} from './planet-shape-terrain-quality';
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

/** The terrain v2 depth probe of the current view (`planet-shape-terrain-quality.ts`). */
export interface PlanetShapeTerrainProbe {
  /** The march as drawn (without the pre-pass), twice, and the reference march. */
  readonly fast: TerrainDepthFrame;
  readonly again: TerrainDepthFrame;
  readonly reference: TerrainDepthFrame;
  readonly camera: QualityProbeCamera;
  /** Radians per probe pixel. */
  readonly pixelAngle: number;
  /** Numbers the drawn contender reports about its own build (contender B: leaves, triangles, timings). */
  readonly contender?: Readonly<Record<string, number>>;
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
  /** Draws terrain v2 of the current view with its fast march (twice) and its reference march, and reads them back. */
  terrainProbe?(): Promise<PlanetShapeTerrainProbe>;
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
  for (const key of ['kind', 'seed', 'bodyId', 'poseId', 'spinWarp', 'morph', 'raySteps', 'rayPrepass', 'rayEdits', 'rayBiome', 'rayRock'] as const) {
    if (actual[key] !== expected[key]) out.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
  }
  if ((actual.meshBlocks ?? true) !== (expected.meshBlocks ?? true)) out.push(`meshBlocks: expected ${expected.meshBlocks ?? true}, found ${actual.meshBlocks ?? true}`);
  const view = (settings: PlanetShapeTestSettings) => (settings.view ? JSON.stringify(settings.view) : 'the pose');
  if (view(actual) !== view(expected)) out.push(`view: expected ${view(expected)}, found ${view(actual)}`);
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
 * Most of the drawn pixels the fast march may get wrong (`compareTerrainDepth`: off the surface, behind it, or drawn by
 * one march only away from an outline). On 2026-10-22 the ten landform views measured 0.00-0.12%, and the same views
 * with the road `set` across the canyon (the bands seen through the arch) 1.66%.
 */
const MAX_WRONG_SHARE = 0.005;
/** The engine's frame timer gives up on a readback while a probe holds the GPU: expected during a probe, not a fault. */
const PROBE_TIMER_ERROR = /^gpuTiming: GpuReadbackTimeoutError/;
/** Most footprints the GPU reference may be off the CPU march on a grid pixel, and how many grid pixels may be. */
const REFERENCE_CPU_FOOTPRINTS = 2;
const REFERENCE_CPU_OFF = 2;
/**
 * Most |field| (footprints) at a reference point. The reference stops on a crossing to a twentieth of a pixel, so the
 * field there is the field's own steepness at grazing views, not a miss: on 2026-10-22 it measured up to 2.2 on an
 * integrated GPU and 4.0 on an RTX 3080 (road-along). A refinement that failed, or a field that jumps, shows far above.
 */
const REFERENCE_FIELD_FOOTPRINTS = 8;

/**
 * Plan 055 terrain quality of the current view: terrain v2's march as drawn against its slow reference march, and the
 * reference against the CPU twin on a grid of pixels (`planet-shape-terrain-quality.ts`). A correctness case.
 */
async function measureTerrainQuality(host: PlanetShapeTestHost, scenario: TestScenario<PlanetShapeTestSettings>, context: TestContext): Promise<TestObservation> {
  if (!host.terrainProbe) throw new Error('This page has no terrain probe');
  await waitForFrames(host, 2, context);
  const before = host.errors();
  host.resetErrors();
  const probe = await host.terrainProbe();
  await waitForFrames(host, 2, context);
  const during = host.errors();
  const timerStalled = PROBE_TIMER_ERROR.test(during);
  const error = before || (timerStalled ? '' : during);
  const result = compareTerrainDepth(probe.fast, probe.reference, probe.pixelAngle);
  const flicker = changedPixels(probe.fast, probe.again);
  const settings = scenario.settings;
  const cpu = checkReferenceOnCpu(probe.reference, labFieldCpu(settings), probe.camera, probe.pixelAngle);
  const cpuOff = cpu.errorFootprints.filter((error) => error > REFERENCE_CPU_FOOTPRINTS).length + cpu.coverageMismatch;
  const mismatches = settingsMismatches(host.read(), settings);
  const { width, height } = probe.fast;
  const checks: TestCheck[] = [
    { name: 'Scenario state applied as specified', passed: mismatches.length === 0, detail: mismatches.join('; ') || undefined },
    { name: 'WebGPU backend in use', passed: host.backendIsWebGpu(), detail: String(host.environment()['backend']) },
    {
      name: 'Terrain v2 or contender B, unmorphed', passed: (settings.kind === 'raymarch-lit' || settings.kind === 'mesh-b') && settings.morph === 0,
      detail: `${settings.kind}, morph ${settings.morph}`,
    },
    { name: 'Terrain drawn by both marches', passed: result.drawnFast > 0 && result.drawnReference > 0, detail: `fast ${result.drawnFast} px, reference ${result.drawnReference} px` },
    { name: 'Reference march finished every pixel', passed: probe.reference.ranOut === 0, detail: `${probe.reference.ranOut} px ran out of steps` },
    {
      name: `Reference drew on the surface (field within ${REFERENCE_FIELD_FOOTPRINTS} footprints of zero)`,
      passed: result.referenceFieldMax <= REFERENCE_FIELD_FOOTPRINTS, detail: `most ${result.referenceFieldMax.toFixed(2)} footprints`,
    },
    {
      name: `Reference agrees with the CPU march (within ${REFERENCE_CPU_FOOTPRINTS} footprints on all but ${REFERENCE_CPU_OFF} grid pixels)`,
      passed: cpu.compared >= 10 && cpuOff <= REFERENCE_CPU_OFF,
      detail: `${cpu.compared} compared, ${cpuOff} off (${cpu.coverageMismatch} drawn by one only)`,
    },
    {
      name: `Fast march matches the reference (at most ${MAX_WRONG_SHARE * 100}% of pixels off the surface, behind it, or drawn by one only away from edges)`,
      passed: result.wrongShare <= MAX_WRONG_SHARE,
      detail: `${(result.wrongShare * 100).toFixed(3)}%: ${result.offSurface} px off the surface, ${result.behind} px behind it, `
        + `${result.coverageWrong} px drawn by one only; ${result.edgeShift} px of edge shift`,
    },
    { name: 'No flicker: two fast frames at a still pose match', passed: flicker === 0, detail: `${flicker} px differ` },
    { name: 'No engine or console error', passed: error === '', detail: error || undefined },
  ];
  const metrics: TestMetric[] = [
    {
      name: 'wrongPixelShare', unit: 'ratio', samples: [result.wrongShare],
      source: `Pixels drawn off the surface (field over ${OFF_SURFACE_FOOTPRINTS} footprints) or behind it (over ${BEHIND_FOOTPRINTS} footprints along the ray), `
        + `or by one march only more than ${EDGE_PIXELS} px from an outline, over the pixels either draws (${width}x${height} probe)`,
    },
    {
      name: 'surfaceFieldFootprints', unit: 'footprints', samples: result.fieldFootprints,
      source: `|field at the fast march's drawn point| over the footprint there, every ${TERRAIN_SAMPLE_STRIDE} px where both draw`,
      unavailableReason: result.fieldFootprints.length ? undefined : 'No pixel drawn by both marches',
    },
    { name: 'offSurfacePixels', unit: 'px', samples: [result.offSurface], source: `Fast points in front of the reference with the field over ${OFF_SURFACE_FOOTPRINTS} footprints from zero` },
    { name: 'behindPixels', unit: 'px', samples: [result.behind], source: `Fast points more than ${BEHIND_FOOTPRINTS} footprints behind the reference along the ray` },
    { name: 'coverageWrongPixels', unit: 'px', samples: [result.coverageWrong], source: `Pixels drawn by one march only, more than ${EDGE_PIXELS} px from the reference's outline` },
    { name: 'edgeShiftPixels', unit: 'px', samples: [result.edgeShift], source: `Pixels off or drawn by one march only within ${EDGE_PIXELS} px of where the reference agrees: fatter or thinner edges` },
    {
      name: 'referenceCpuErrorFootprints', unit: 'footprints', samples: cpu.errorFootprints,
      source: `|GPU reference - CPU reference march (doubles)| over the footprint, on a ${CPU_CHECK_GRID.columns}x${CPU_CHECK_GRID.rows} pixel grid where both draw`,
      unavailableReason: cpu.errorFootprints.length ? undefined : 'No grid pixel drawn by both',
    },
    { name: 'fastRanOutPixels', unit: 'px', samples: [probe.fast.ranOut], source: 'Fast march pixels that ran out of steps inside the band (drawn where they stopped)' },
    { name: 'flickerPixels', unit: 'px', samples: [flicker], source: 'Pixels whose drawn flag or distance differ between two fast frames of the same view' },
  ];
  return {
    metrics,
    checks,
    details: {
      probeWidth: width, probeHeight: height, pixelAngle: probe.pixelAngle, drawnFast: result.drawnFast, drawnReference: result.drawnReference,
      offSurfacePixels: result.offSurface, behindPixels: result.behind, coverageWrongPixels: result.coverageWrong, edgeShiftPixels: result.edgeShift,
      referenceRanOut: probe.reference.ranOut, referenceFieldMaxFootprints: result.referenceFieldMax,
      frameTimerStalledByProbe: timerStalled,
      referenceCpuCompared: cpu.compared, referenceCpuCoverageMismatch: cpu.coverageMismatch,
      surfaceFieldMaxFootprints: max(result.fieldFootprints), referenceCpuErrorMaxFootprints: max(cpu.errorFootprints),
      ...Object.fromEntries(Object.entries(probe.contender ?? {}).map(([key, value]) => [`contender.${key}`, value])),
    },
    validityIssues: [],
    limitations: [
      'The fast frame is the march as drawn but without the pre-pass (the probe target has its own size); the pre-pass can only start a ray later, so it may miss features thinner than a coarse pixel that this does not see.',
      `The reference trusts the field up to a slope of 64 and never steps under a pixel: ground thinner than a pixel can still be missed by both. It is checked against the CPU twin on ${CPU_CHECK_GRID.columns * CPU_CHECK_GRID.rows} pixels only.`,
      'A fast point in front of the reference with the field near zero passes however far it is along the ray: that is the half-pixel cone stop at a grazing angle, and on screen the same place.',
      'The probe holds the GPU long enough for the engine\'s frame timer to give up on a readback; that error is expected during the probe and not counted.',
      'Shading is not compared: a pixel at the right depth with a wrong normal is not caught.',
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
      if (scenario.settings.probe === 'terrain-quality') return measureTerrainQuality(host, scenario, context);
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
      const expectDrawn = settings.kind !== 'empty';
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
