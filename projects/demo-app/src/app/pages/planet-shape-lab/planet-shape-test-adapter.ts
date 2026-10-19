import type { GpuPassKind, IGpuPassSummary } from 'triangular-engine';
import type { TestCheck, TestContext, TestMetric, TestObservation, TestRunAdapter, TestScenario, TestSetting } from 'triangular-engine/testing';
import { featureMismatches } from './planet-shape-features';
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
  stopSampling(): PlanetShapeFrameSummary;
  environment(): Readonly<Record<string, TestSetting>>;
}

const READY_TIMEOUT_MS = 60_000;
const STALL_MS = 5_000;
const MIN_WINDOW_FRAMES = 60;
const SETTLE_FRAMES = 3;

/** Names every field the page did not honour; the spin angle advances on its own and is not compared. */
export function settingsMismatches(actual: PlanetShapeTestSettings, expected: PlanetShapeTestSettings): string[] {
  const out: string[] = [];
  for (const key of ['kind', 'seed', 'bodyId', 'poseId', 'spinWarp'] as const) {
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
    capture: () => host.read(),
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => waitSettled(scenario, context),
    measure: async (scenario, context): Promise<TestObservation> => {
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
        await context.wait(scenario.durationMs);
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
  };
}
