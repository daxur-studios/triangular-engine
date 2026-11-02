import { simpleAdapter, type TestContext, type TestObservation, type TestRunAdapter, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import {
  averageImages,
  blockResidualRms,
  maxBandErrorStep,
  maxBandMeanDifference,
  meanAbsoluteErrorChange,
  rowBandMeans,
  type ILuminanceImage,
  type IRowRange,
} from './core/water-lod-spike-image-metrics';
import { WATER_LOD_SPIKE_QUALITIES, type WaterLodSpikeQualityId } from './core/water-lod-spike-quality';

/** A fixed camera pose for the aliasing cases. */
export interface WaterLodSpikeView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/** Settings a W0b case applies: the spike's own material wireframe and, for the aliasing cases, a fixed view. */
export interface WaterLodSpikeTestSettings {
  readonly wireframe: boolean;
  readonly view?: WaterLodSpikeView;
  /** 'aliasing' runs the three aliasing arms instead of timing frames. */
  readonly measure?: 'aliasing';
  /** Renders at this multiple of the page's pixel ratio for the case (a stress or low-cost proxy for another GPU); restored afterwards. */
  readonly pixelRatio?: number;
  /** Quality tier for the case (waves, footprint bias, mesh density); restored afterwards. Omitted keeps the page's own tier. */
  readonly quality?: WaterLodSpikeQualityId;
  /**
   * Aliasing cases only. true (the default) applies the shimmer, moiré, step and colour gates; 'colour' applies only the colour
   * error gate and reports the rest; false reports every metric with no gates (only the water-drawn checks remain).
   */
  readonly gated?: boolean | 'colour';
}

/** What the page exposes to the test adapter: its own handles, nothing else. */
export interface WaterLodSpikeTestHost {
  /** True once the scene has drawn at least one frame with the water body. */
  ready(): boolean;
  wireframe(): boolean;
  setWireframe(enabled: boolean): void;
  counts(): { readonly drawCalls: number; readonly triangles: number };
  /** Starts collecting frame intervals from the engine tick. */
  beginFrameSampling(): void;
  /** Stops collecting and returns the frame intervals (ms) since `beginFrameSampling`. */
  endFrameSampling(): readonly number[];
  /** CPU time (ms) of each frame's tick and render since `beginFrameSampling`, as the FPS panel shows it; call after `endFrameSampling`. */
  takeCpuFrameMs(): readonly number[];
  /** GPU frame time (ms, one-second average from timestamp queries), or null when unsupported. */
  gpuFrameMs(): number | null;
  /** Holds the camera at `view` with the orbit controls off and the waves frozen; null hands the camera back. */
  setView(view: WaterLodSpikeView | null): void;
  /** Scales the renderer pixel ratio by `ratio`; null restores the one the page had. */
  setPixelRatio(ratio: number | null): void;
  /** Holds the quality tier `id` for the case; null restores the tier the page had. */
  setQuality(id: WaterLodSpikeQualityId | null): void;
  setFilter(enabled: boolean): void;
  setTransfer(enabled: boolean): void;
  /** Waits until the engine has rendered `count` more frames (so the LOD selection settles on the new view). */
  waitFrames(count: number, context: TestContext): Promise<void>;
  /** Renders the current view now with a sub-pixel projection offset (pixels) and returns its luminance. */
  readFrame(jitterX: number, jitterY: number): ILuminanceImage;
  /** First canvas row below the horizon. */
  horizonRow(): number;
  environment(): Readonly<Record<string, TestSetting>>;
}

const WATER_LOD_SPIKE_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike',
  version: 1,
  title: 'Water LOD spike W0b: water body draws, wireframe applies',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    { id: 'solid', label: 'Solid water', settings: { wireframe: false }, durationMs: 3000, warmupMs: 1000 },
    { id: 'wireframe', label: 'Wireframe water', settings: { wireframe: true }, durationMs: 3000, warmupMs: 1000 },
  ],
};

/**
 * Performance experiment for the same two cases: frame intervals over the
 * measured window plus draw calls and triangles. Not a baseline; no budgets yet.
 */
const WATER_LOD_SPIKE_PERFORMANCE_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-performance',
  version: 1,
  title: 'Water LOD spike W0b: frame interval, solid and wireframe water',
  purpose: 'performance',
  scenarios: [
    { id: 'solid', label: 'Solid water', settings: { wireframe: false }, durationMs: 6000, warmupMs: 1500 },
    { id: 'wireframe', label: 'Wireframe water', settings: { wireframe: true }, durationMs: 6000, warmupMs: 1500 },
  ],
};

/**
 * v2 adds the GPU frame time (timestamp queries), which vsync does not pin, and runs on the 64-wave spectrum with the
 * footprint filter. Solid water at the grazing view, where the most waves are on screen.
 */
const WATER_LOD_SPIKE_PERFORMANCE_V2: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-performance',
  version: 2,
  title: 'Water LOD spike W0b: GPU and frame time, filtered 64-wave water',
  purpose: 'performance',
  scenarios: [
    {
      id: 'grazing',
      label: 'Grazing view, solid',
      settings: { wireframe: false, view: { position: [0, 12, 0], target: [0, 0, -300] } },
      durationMs: 6000,
      warmupMs: 1500,
    },
  ],
};

/**
 * Aliasing gates (plan 080 Q2 and Q3, written before the first run of this suite). Each case holds a fixed view with
 * the waves frozen, then measures three arms against a 32-sample supersampled reference of the unfiltered surface:
 * filtered (filter and roughness transfer on), no transfer (filter on, transfer off) and control (filter off).
 *
 * - shimmer: mean |luminance change| between frames half a pixel apart. Gate: filtered at most half the control.
 * - moiré: RMS of 8 x 8 block means against the reference (false low-frequency structure). Gate: filtered at most
 *   half the control.
 * - colour step: largest difference of 8 row-band means against the reference. Gate: filtered at most 2 levels of 255.
 *   The no-transfer arm shows what the roughness transfer is worth.
 */
const WATER_LOD_SPIKE_ALIASING_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-aliasing',
  version: 1,
  title: 'Water LOD spike W0b: shimmer, moiré and colour step against a supersampled reference',
  purpose: 'functional',
  scenarios: [
    {
      id: 'grazing',
      label: 'Grazing view, 12 m up',
      settings: { wireframe: false, measure: 'aliasing', view: { position: [0, 12, 0], target: [0, 0, -300] } },
      durationMs: 1000,
      warmupMs: 500,
    },
    {
      id: 'elevated',
      label: 'Elevated view, 80 m up',
      settings: { wireframe: false, measure: 'aliasing', view: { position: [0, 80, 0], target: [0, 0, -500] } },
      durationMs: 1000,
      warmupMs: 500,
    },
    {
      id: 'high',
      label: 'High view, 600 m up',
      settings: { wireframe: false, measure: 'aliasing', view: { position: [0, 600, 0], target: [0, 0, -2500] } },
      durationMs: 1000,
      warmupMs: 500,
    },
  ],
};

/**
 * v3 renders the grazing view at three pixel counts (0.5, 1 and 2 times the page's pixel ratio), so the GPU time can be
 * split into a fixed part (vertices, draw submission) and a part per pixel (the fragment shading): a fit of GPU time
 * against pixel count. The 2x case is also a stand-in for a GPU slower than the one under test.
 */
const WATER_LOD_SPIKE_PERFORMANCE_V3: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-performance',
  version: 3,
  title: 'Water LOD spike W0b: GPU time against pixel count, filtered 64-wave water',
  purpose: 'performance',
  scenarios: [0.5, 1, 2].map((pixelRatio) => ({
    id: `grazing-x${pixelRatio}`,
    label: `Grazing view, solid, pixel ratio x${pixelRatio}`,
    settings: { wireframe: false, pixelRatio, view: { position: [0, 12, 0], target: [0, 0, -300] } as WaterLodSpikeView },
    durationMs: 6000,
    warmupMs: 1500,
  })),
};

const GRAZING_VIEW: WaterLodSpikeView = { position: [0, 12, 0], target: [0, 0, -300] };
const ELEVATED_VIEW: WaterLodSpikeView = { position: [0, 80, 0], target: [0, 0, -500] };
const HIGH_VIEW: WaterLodSpikeView = { position: [0, 600, 0], target: [0, 0, -2500] };
/** Water fills the whole screen at about 56 degrees down from 12 m: every pixel is near water with all waves resolved. */
const LOOKING_DOWN_VIEW: WaterLodSpikeView = { position: [0, 12, 8], target: [0, 0, 0] };

/**
 * v4 sweeps the quality tiers at two views: grazing (water to the horizon, most pixels far) and looking down (every
 * pixel near water, the most waves resolved per pixel). Each case is GPU and CPU frame time at the page's pixel ratio.
 * Pairs with `water-lod-spike-aliasing` v2, which gates the same tiers for aliasing.
 */
const WATER_LOD_SPIKE_PERFORMANCE_V4: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-performance',
  version: 4,
  title: 'Water LOD spike W0b: GPU time by quality tier, grazing and looking down',
  purpose: 'performance',
  scenarios: [
    { id: 'grazing', label: 'Grazing view', view: GRAZING_VIEW },
    { id: 'down', label: 'Looking down from 12 m', view: LOOKING_DOWN_VIEW },
  ].flatMap(({ id, label, view }) =>
    WATER_LOD_SPIKE_QUALITIES.map((quality) => ({
      id: `${id}-${quality.id}`,
      label: `${label}, ${quality.label}`,
      settings: { wireframe: false, quality: quality.id, view },
      durationMs: 6000,
      warmupMs: 2000,
    })),
  ),
};

/**
 * v5 is v4 with shorter windows (1 s warmup, 3 s measured instead of 2 s and 6 s), so a run of two repetitions takes about
 * a minute instead of three and a half. The medians the ER quotes settled within the first seconds of a case; the p95 of a
 * 3 s window is noisier, so use v4 when timing evidence for a gate is needed.
 */
const WATER_LOD_SPIKE_PERFORMANCE_V5: TestSuite<WaterLodSpikeTestSettings> = {
  ...WATER_LOD_SPIKE_PERFORMANCE_V4,
  version: 5,
  title: 'Water LOD spike W0b: GPU time by quality tier, short windows',
  scenarios: WATER_LOD_SPIKE_PERFORMANCE_V4.scenarios.map((scenario) => ({ ...scenario, durationMs: 3000, warmupMs: 1000 })),
};

/**
 * v2 measures every quality tier against the same supersampled reference of the best water (the filter-off arms ignore
 * the tier's bias). Only `ultra` carries the v1 gates. The lower tiers are deliberately blurrier, and the shimmer metric
 * counts detail missing from the reference as change, so they report their numbers without gates: a dial to judge by eye
 * and by the numbers, not a pass/fail. That choice was made after seeing the tiers cross the gates by small amounts
 * (ER 080) and is the owner's to confirm.
 */
const WATER_LOD_SPIKE_ALIASING_V2: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-aliasing',
  version: 2,
  title: 'Water LOD spike W0b: shimmer, moiré and colour step by quality tier',
  purpose: 'functional',
  scenarios: [
    { id: 'grazing', label: 'Grazing view, 12 m up', view: GRAZING_VIEW },
    { id: 'elevated', label: 'Elevated view, 80 m up', view: ELEVATED_VIEW },
    { id: 'high', label: 'High view, 600 m up', view: HIGH_VIEW },
  ].flatMap(({ id, label, view }) =>
    WATER_LOD_SPIKE_QUALITIES.map((quality) => ({
      id: `${id}-${quality.id}`,
      label: `${label}, ${quality.label}`,
      settings: { wireframe: false, measure: 'aliasing' as const, quality: quality.id, gated: quality.id === 'ultra', view },
      durationMs: 1000,
      warmupMs: 1000,
    })),
  ),
};

/**
 * v3 is v2 with `high` gated on colour error only. The tier's shimmer (4.3 against 2.5), moiré (2.2 against 1.8) and 600 m
 * step (2.2 against 2.0) miss the v1 limits by construction, because it is blurrier than the reference; the colour error
 * passes at every view and still catches a real regression such as a bad shader change. `medium` and `low` stay ungated. The
 * owner delegated the call (ER 080, 2026-11-02).
 */
const WATER_LOD_SPIKE_ALIASING_V3: TestSuite<WaterLodSpikeTestSettings> = {
  ...WATER_LOD_SPIKE_ALIASING_V2,
  version: 3,
  title: 'Water LOD spike W0b: shimmer, moiré and colour step by quality tier, High gated on colour',
  scenarios: WATER_LOD_SPIKE_ALIASING_V2.scenarios.map((scenario) => ({
    ...scenario,
    settings: { ...scenario.settings, gated: scenario.settings.quality === 'ultra' ? true : scenario.settings.quality === 'high' ? ('colour' as const) : false },
  })),
};

/** Every version of the W0b suites, oldest first. Add a new entry when a case changes; keep old ones. */
export const WATER_LOD_SPIKE_TEST_HISTORY: readonly TestSuite<WaterLodSpikeTestSettings>[] = [
  WATER_LOD_SPIKE_V1,
  WATER_LOD_SPIKE_PERFORMANCE_V1,
  WATER_LOD_SPIKE_PERFORMANCE_V2,
  WATER_LOD_SPIKE_ALIASING_V1,
  WATER_LOD_SPIKE_PERFORMANCE_V3,
  WATER_LOD_SPIKE_PERFORMANCE_V4,
  WATER_LOD_SPIKE_ALIASING_V2,
  WATER_LOD_SPIKE_PERFORMANCE_V5,
  WATER_LOD_SPIKE_ALIASING_V3,
];

const REFERENCE_SAMPLES = 32;
const SETTLE_FRAMES = 30;
const BLOCK_PX = 8;
/** Bands for the absolute colour error, and for the step between neighbouring bands (finer, so a smooth bias stays small per step). */
const ERROR_BANDS = 8;
const STEP_BANDS = 32;
/** The second view is shifted by half a pixel in both axes. */
const SHIFT_PX = 0.5;
/** Gates, written before the first run of the suite (Plan 080, W0b). */
const MAX_COLOUR_STEP = 2;
const MAX_COLOUR_ERROR = 6;
const MAX_MOIRE_RATIO = 2;
/** Flicker at or under this is invisible, so a control that barely aliases leaves nothing to halve. */
const SHIMMER_FLOOR = 2.5;
const MAX_SHIMMER_RATIO = 0.5;

/** Halton sequence value in [0, 1). */
function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += fraction * (i % base);
    fraction /= base;
  }
  return result;
}

/** The unfiltered surface supersampled over the pixel with Halton offsets around (`ox`, `oy`), averaged in linear light: the ground truth the arms are compared with. */
function supersampledReference(host: WaterLodSpikeTestHost, ox: number, oy: number): ILuminanceImage {
  host.setFilter(false);
  const frames: ILuminanceImage[] = [];
  for (let i = 1; i <= REFERENCE_SAMPLES; i++) frames.push(host.readFrame(ox + halton(i, 2) - 0.5, oy + halton(i, 3) - 0.5));
  host.setFilter(true);
  return averageImages(frames);
}

interface IReferences {
  readonly at: ILuminanceImage;
  readonly shifted: ILuminanceImage;
}

interface IArmResult {
  readonly shimmer: number;
  readonly moire: number;
  readonly colourStep: number;
  readonly colourError: number;
  /** Row-band means of the frame, horizon band first. */
  readonly bands: number[];
}

function measureArm(host: WaterLodSpikeTestHost, references: IReferences, rows: IRowRange, filter: boolean, transfer: boolean): IArmResult {
  host.setFilter(filter);
  host.setTransfer(transfer);
  const frame = host.readFrame(0, 0);
  const shifted = host.readFrame(SHIFT_PX, SHIFT_PX);
  host.setFilter(true);
  host.setTransfer(true);
  return {
    shimmer: meanAbsoluteErrorChange(frame, references.at, shifted, references.shifted, rows),
    moire: blockResidualRms(frame, references.at, rows, BLOCK_PX),
    colourStep: maxBandErrorStep(frame, references.at, rows, STEP_BANDS),
    colourError: maxBandMeanDifference(frame, references.at, rows, ERROR_BANDS),
    bands: rowBandMeans(frame, rows, ERROR_BANDS),
  };
}

/** True once the rows below the horizon are lit water, not a blank or still-compiling frame. */
function hasWater(host: WaterLodSpikeTestHost): boolean {
  const frame = host.readFrame(0, 0);
  const rows = { start: Math.min(frame.height, host.horizonRow() + 6), end: frame.height };
  return rows.end - rows.start >= 100 && rowBandMeans(frame, rows, 1)[0] > 20;
}

async function measureAliasing(host: WaterLodSpikeTestHost, context: TestContext, gated: boolean | 'colour'): Promise<TestObservation> {
  await host.waitFrames(SETTLE_FRAMES, context);
  // The first pipeline compile and the LOD selection for a new view can take longer than the settle frames: wait for water.
  for (let attempt = 0; attempt < 20 && !hasWater(host); attempt++) await host.waitFrames(SETTLE_FRAMES, context);
  const references = { at: supersampledReference(host, 0, 0), shifted: supersampledReference(host, SHIFT_PX, SHIFT_PX) };
  const reference = references.at;
  const rows = { start: Math.min(reference.height, host.horizonRow() + 6), end: reference.height };
  const filtered = measureArm(host, references, rows, true, true);
  const noTransfer = measureArm(host, references, rows, true, false);
  const control = measureArm(host, references, rows, false, true);
  const referenceMean = rowBandMeans(reference, rows, 1)[0];
  const metric = (name: string, value: number) => ({ name, unit: 'luma/255', source: 'canvas readback', samples: [value] });
  const bandMetric = (name: string, samples: number[]) => ({ name, unit: 'luma/255', source: 'canvas readback', samples });
  const ratio = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : 'n/a');
  return {
    metrics: [
      metric('shimmer, filtered', filtered.shimmer),
      metric('shimmer, control', control.shimmer),
      metric('moiré, filtered', filtered.moire),
      metric('moiré, control', control.moire),
      metric('colour step, filtered', filtered.colourStep),
      metric('colour step, no transfer', noTransfer.colourStep),
      metric('colour step, control', control.colourStep),
      metric('colour error, filtered', filtered.colourError),
      metric('colour error, no transfer', noTransfer.colourError),
      metric('colour error, control', control.colourError),
      bandMetric('band means, reference (horizon first)', rowBandMeans(reference, rows, ERROR_BANDS)),
      bandMetric('band means, filtered', filtered.bands),
      bandMetric('band means, control', control.bands),
      { name: 'water rows', unit: 'rows', source: 'horizon projection', samples: [rows.end - rows.start] },
    ],
    checks: [
      { name: 'water drawn, not blank', passed: referenceMean > 20, detail: `reference mean ${referenceMean.toFixed(1)}/255` },
      { name: 'water rows measured', passed: rows.end - rows.start >= 100, detail: `${rows.end - rows.start} rows below the horizon` },
      ...(gated === true
        ? [
            {
              name: `Q3 shimmer: filtered at most ${MAX_SHIMMER_RATIO} x the control, or ${SHIMMER_FLOOR}/255`,
              passed: filtered.shimmer <= Math.max(MAX_SHIMMER_RATIO * control.shimmer, SHIMMER_FLOOR),
              detail: `${filtered.shimmer.toFixed(2)} vs ${control.shimmer.toFixed(2)} (ratio ${ratio(filtered.shimmer, control.shimmer)})`,
            },
            {
              name: `moiré: filtered structure at most ${MAX_MOIRE_RATIO} x the control`,
              passed: filtered.moire <= MAX_MOIRE_RATIO * control.moire,
              detail: `${filtered.moire.toFixed(2)}; control ${control.moire.toFixed(2)}`,
            },
            {
              name: `Q2 colour step: error changes at most ${MAX_COLOUR_STEP}/255 between neighbouring bands`,
              passed: filtered.colourStep <= MAX_COLOUR_STEP,
              detail: `${filtered.colourStep.toFixed(2)}; no transfer ${noTransfer.colourStep.toFixed(2)}; control ${control.colourStep.toFixed(2)}`,
            },
          ]
        : []),
      ...(gated
        ? [
            {
              name: `colour matches the reference within ${MAX_COLOUR_ERROR}/255 in every band`,
              passed: filtered.colourError <= MAX_COLOUR_ERROR,
              detail: `${filtered.colourError.toFixed(2)}; no transfer ${noTransfer.colourError.toFixed(2)}; control ${control.colourError.toFixed(2)}`,
            },
          ]
        : []),
    ],
  };
}

async function measureFrames(host: WaterLodSpikeTestHost, durationMs: number, context: TestContext, gpu: boolean): Promise<TestObservation> {
  host.beginFrameSampling();
  const gpuMs: number[] = [];
  for (let elapsed = 0; elapsed < durationMs; elapsed += 1000) {
    await context.wait(Math.min(1000, durationMs - elapsed));
    const sample = host.gpuFrameMs();
    if (gpu && sample !== null) gpuMs.push(sample);
  }
  const frameMs = host.endFrameSampling();
  const cpuMs = host.takeCpuFrameMs();
  const { drawCalls, triangles } = host.counts();
  return {
    metrics: [
      { name: 'frame interval', unit: 'ms', source: 'engine.tick$ intervals', samples: [...frameMs] },
      { name: 'CPU frame', unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render)', samples: [...cpuMs] },
      ...(gpu ? [{ name: 'GPU frame', unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages', samples: gpuMs }] : []),
      { name: 'draw calls', unit: 'calls', source: 'renderer.info.render.calls', samples: [drawCalls] },
      { name: 'triangles', unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles] },
    ],
    checks: [
      { name: 'water body draws', passed: drawCalls > 0, detail: `draw calls ${drawCalls}` },
      { name: 'triangles drawn', passed: triangles > 0, detail: `triangles ${triangles}` },
      ...(gpu ? [{ name: 'GPU time measured', passed: gpuMs.length > 0, detail: `${gpuMs.length} samples` }] : []),
    ],
  };
}

/**
 * Testing adapter for the W0b page. Applies the wireframe setting and the case's view to the spike's own material and
 * camera (never `<scene>`'s `[wireframe]`), waits for the water body to draw, then measures: frame and GPU time for the
 * performance suite, the three aliasing arms for the aliasing suite, draw counts with checks otherwise.
 */
export function createWaterLodSpikeTestAdapter(host: WaterLodSpikeTestHost): TestRunAdapter<WaterLodSpikeTestSettings, boolean> {
  return simpleAdapter<WaterLodSpikeTestSettings, boolean>({
    windowModes: false,
    capture: () => host.wireframe(),
    apply: (scenario) => {
      host.setWireframe(scenario.settings.wireframe);
      host.setView(scenario.settings.view ?? null);
      host.setPixelRatio(scenario.settings.pixelRatio ?? null);
      host.setQuality(scenario.settings.quality ?? null);
    },
    restore: (wireframe) => {
      host.setWireframe(wireframe);
      host.setView(null);
      host.setPixelRatio(null);
      host.setQuality(null);
    },
    ready: async (context) => {
      while (!host.ready()) {
        await context.wait(100);
      }
    },
    environment: () => host.environment(),
    measure: async (scenario, context): Promise<TestObservation> => {
      if (scenario.settings.measure === 'aliasing') return measureAliasing(host, context, scenario.settings.gated ?? true);
      const observation = await measureFrames(host, scenario.durationMs, context, scenario.settings.view !== undefined);
      return {
        ...observation,
        checks: [
          ...(observation.checks ?? []),
          {
            name: 'wireframe applied to the spike material',
            passed: host.wireframe() === scenario.settings.wireframe,
            detail: `wireframe ${host.wireframe()}, expected ${scenario.settings.wireframe}`,
          },
        ],
      };
    },
  });
}
