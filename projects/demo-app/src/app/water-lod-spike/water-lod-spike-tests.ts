import { simpleAdapter, type TestContext, type TestObservation, type TestRecordingCapture, type TestRunAdapter, type TestSetting, type TestSuite } from 'triangular-engine/testing';
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
import type { ILeafCull, IShoreAudit, IShoreLookAudit, ITerrainReadAudit } from './core/water-lod-spike-land';
import { CONTROL_MIN_ERROR_RAD, MAX_PHASE_ERROR_RAD, type IPrecisionReport } from './core/water-lod-spike-precision';
import { WATER_LOD_SPIKE_QUALITIES, type WaterLodSpikeQualityId } from './core/water-lod-spike-quality';

/** A fixed camera pose for the aliasing cases. */
export interface WaterLodSpikeView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/**
 * One point on a motion case's camera path. `at` is the fraction of the case's duration (0 to 1). The pose between points eases from
 * one to the next. The camera sits at the view's offset from its target, turned `azimuthDeg` degrees about the vertical axis through
 * the target and scaled by `distance` (1 is the view's own distance, 0.4 is zoomed in), with the target moved by `pan` metres (x, z).
 */
export interface WaterLodSpikeMotionKey {
  readonly at: number;
  readonly azimuthDeg: number;
  readonly distance: number;
  readonly pan: readonly [number, number];
}

/** A scripted camera path with quality switches, for the cases that record how the water and land look while the camera moves. */
export interface WaterLodSpikeMotion {
  /** The pose the path is measured from: its offset from its target is distance 1 at azimuth 0. */
  readonly view: WaterLodSpikeView;
  /** Camera path points, ordered by `at`; the first is at 0 and the last at 1. */
  readonly keys: readonly WaterLodSpikeMotionKey[];
  /** Quality tiers to switch to while the camera moves (`at` as for the keys); the case's own `quality` is the tier it starts in. */
  readonly qualityAt?: readonly { readonly at: number; readonly quality: WaterLodSpikeQualityId }[];
}

/** Settings a W0b case applies: the spike's own material wireframe and, for the aliasing cases, a fixed view. */
export interface WaterLodSpikeTestSettings {
  readonly wireframe: boolean;
  readonly view?: WaterLodSpikeView;
  /** 'aliasing' runs the three aliasing arms instead of timing frames; 'precision' runs the Q5 phase-precision probe. */
  readonly measure?: 'aliasing' | 'precision' | 'land' | 'cull' | 'shore' | 'shore-look' | 'terrain-read' | 'coast-look' | 'terrain-cost' | 'camera-quality';
  /**
   * Camera-quality cases: the camera moves along this path through the page's own orbit controls while the waves animate, and the
   * quality switches along the way. These cases record a clip; nothing about the case holds the camera still.
   */
  readonly motion?: WaterLodSpikeMotion;
  /** Shore cases: the water body's detail noise on or off; restored afterwards. Omitted keeps the page's own setting. */
  readonly waterNoise?: boolean;
  /** Shore cases: the depth weight on the waves on or off; restored afterwards. Omitted keeps the page's own setting. */
  readonly shore?: boolean;
  /** Cull cases: the library cover hook on the water body (water leaves under the land are not drawn and take no budget); restored afterwards. */
  readonly cull?: boolean;
  /** Land under the water for the case (the w2 spike's islands); restored afterwards. Omitted keeps the page's own setting. */
  readonly land?: boolean;
  /** Land cases: 'open-sea' expects no dry leaf; 'shore' expects the centre-only control to make wrong calls. */
  readonly landExpect?: 'open-sea' | 'shore';
  /** Renders at this multiple of the page's pixel ratio for the case (a stress or low-cost proxy for another GPU); restored afterwards. */
  readonly pixelRatio?: number;
  /** Quality tier for the case (waves, footprint bias, mesh density); restored afterwards. Omitted keeps the page's own tier. */
  readonly quality?: WaterLodSpikeQualityId;
  /** Visual cases: the water and the land body read the baked terrain texture (true) or the analytic islands (false); restored afterwards. */
  readonly bakedTerrain?: boolean;
  /**
   * Coast cases: after settling, the camera sweeps this many degrees around the view's target at the view's radius and height, over the
   * case's duration. These are the cases that record a clip (the camera moving is what a clip shows that a still cannot).
   */
  readonly orbitDegrees?: number;
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
  /**
   * Moves the camera to `view` through the page's orbit controls (call it every frame to move it): the controls stay live, the waves
   * keep animating and the pose is applied ahead of the controls' update. Null hands the camera back.
   */
  setLiveCamera(view: WaterLodSpikeView | null): void;
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
  /** Land under the water on or off; null restores the page's own setting. */
  setLand(enabled: boolean | null): void;
  /** True once the land body's pipeline is compiled and it draws. */
  landDrawn(): boolean;
  /** The water body's drawn leaves of the last selection, judged against the land. */
  landLeaves(coverMargin?: boolean): ILeafCull;
  /** The same judged over every selected leaf, drawn or not, against the cover hook's own ceiling (water bound plus margin): how the leaves a hook removed are audited. */
  landAudit(): ILeafCull;
  /** The cover hook on the water body on or off (it acts only while the land is on); null restores the page's own setting. */
  setCull(enabled: boolean | null): void;
  /** True while the water body's selector has a cover hook installed. */
  coverActive(): boolean;
  /** The water body's detail noise on or off; null restores the page's own setting. */
  setWaterNoise(enabled: boolean | null): void;
  /** The depth weight on the waves on or off; null restores the page's own setting. */
  setShore(enabled: boolean | null): void;
  /** The crescent gate: dry points where the water the body would draw (at each of `times`, seconds) stands above the land. */
  shoreAudit(times: readonly number[]): IShoreAudit;
  /** Foam at the waterline and breaker lines on or off; null restores the page's own setting. The next frame read shows it. */
  setFoam(enabled: boolean | null): void;
  /** The shallow-to-deep water colour on or off; null restores the page's own setting. */
  setDepthColour(enabled: boolean | null): void;
  /** The shore look gate over the audit grid with both looks on, judged against the land. */
  shoreLookAudit(): IShoreLookAudit;
  /** The water and the land body read the terrain from the baked texture (on) or the analytic islands (off); null restores the page's own setting. */
  setBakedTerrain(enabled: boolean | null): void;
  /** The water's depth read alone from the baked texture (on) or the analytic islands (off), whatever the land body draws; null makes it follow the land body again. */
  setWaterRead(enabled: boolean | null): void;
  /** The correctness gate for the baked read: the water depth from the baked texture against the analytic islands, over the audit grid. */
  terrainReadAudit(): ITerrainReadAudit;
  /** What the baked terrain texture is: texture size exponent, metres per texel, size and bake time. */
  terrainReadInfo(): { readonly k: number; readonly texelM: number; readonly megabytes: number; readonly bakeMs: number };
  /** A small picture of the canvas for the results page and review sheets; not evidence and never taken inside a timing window. */
  thumbnail?(): Promise<Blob | undefined>;
  /**
   * A bounded recording of the canvas for the opt-in clip; the testing entry starts it before `measure` and stops it after.
   * `shot` is the case id, burned into each frame and stored in the clip's per-frame sidecar.
   */
  recording?(shot: string): TestRecordingCapture;
  /** Runs the Q5 phase-precision compute kernel on the page's renderer and compares it with the double reference. */
  runPrecisionProbe(): Promise<IPrecisionReport>;
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

/**
 * Plan 080 Q5, written before the first run. A compute kernel evaluates the wave phase in float32 for 64 waves at points on a
 * 600 km sphere out to the horizon of an eye 2 m up, two ways, and compares it with doubles:
 *
 * - anchor-relative (position relative to the anchor, phase offset from the CPU in doubles): at most 1e-3 rad;
 * - naive (global position, the flat spike's formula): the control, which must miss that limit by at least 0.01 rad.
 *
 * Both run at wave time 0 and at one hour. A wave is judged only within its range, the distance past which the vertex
 * filter drops it (ultra tier, 4K). The sine of the anchor phase is reported but not gated.
 */
const WATER_LOD_SPIKE_PRECISION_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-precision',
  version: 1,
  title: 'Water LOD spike W0b Q5: wave phase precision on a 600 km sphere, anchor-relative against naive',
  purpose: 'functional',
  scenarios: [{ id: 'sphere-600km-eye-2m', label: '600 km sphere, eye 2 m', settings: { wireframe: false, measure: 'precision' }, durationMs: 1000, warmupMs: 500 }],
};

/**
 * Plan 080 w2 spike, written before the first run: how much of the water the selector spends on land, and what the water
 * costs with land in front of it. Each view runs with the land off (water only) and on (land drawn first, water behind).
 *
 * Correctness gates, from the leaf test (`core/water-lod-spike-land.ts`):
 * - the conservative dry test never calls a leaf dry when a dense sample of it finds a wet point (0 wrong calls);
 * - the centre-only control makes wrong calls in the shore views (so the check can detect an unsafe test);
 * - open sea has no dry leaf.
 *
 * Reported, not gated: dry share of the drawn leaves, GPU and CPU frame time, triangles. The cost numbers decide whether a
 * library cull hook is worth its edit (ER 080); they are headless-hardware numbers, not Q1.
 */
const WATER_LOD_SPIKE_LAND_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-land',
  version: 1,
  title: 'Water LOD spike w2: water leaves under land, and the cost with land in front',
  purpose: 'performance',
  scenarios: [
    { id: 'coast-200m', label: 'Coast from 200 m', view: { position: [0, 200, 600], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'coast-grazing-2m', label: 'Coast, grazing from 2 m', view: { position: [0, 2, 800], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'down-800m', label: 'Looking down from 800 m', view: { position: [0, 800, -600], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'islands-5km', label: 'Islands from 5 km', view: { position: [0, 5000, 9000], target: [3000, 0, -1000] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'open-sea-200m', label: 'Open sea from 200 m', view: { position: [-30000, 200, 30000], target: [-30000, 0, 45000] } as WaterLodSpikeView, expect: 'open-sea' as const },
  ].flatMap(({ id, label, view, expect }) =>
    [false, true].map((land) => ({
      id: `${id}-${land ? 'land' : 'water-only'}`,
      label: `${label}, ${land ? 'land drawn' : 'water only'}`,
      settings: { wireframe: false, measure: 'land' as const, land, landExpect: expect, view },
      durationMs: 4000,
      warmupMs: 1500,
    })),
  ),
};

/**
 * Plan 080 w2, the real part: the selector's cover hook. Same five views as the spike suite, land always on, the hook off or on.
 * Written before the first run.
 *
 * Gates:
 * - safety: no selected leaf, drawn or not, is called dry by the hook's test while a dense sample of it finds a wet point
 *   (0 wrong calls over every selected leaf), and the hook is installed exactly when asked;
 * - removal: with the hook on, no drawn leaf lies entirely under land in the shore views (the hook took them all out);
 * - open sea: the hook covers no leaf there.
 *
 * Reported, not gated: leaves covered, drawn, nodes still wanting to split (`unmet`), the deepest level, the mean edge of the
 * drawn leaves that hold water (smaller is finer water where it can be seen), and GPU and CPU frame time. The question these
 * answer: does the budget a covered leaf no longer takes show up as finer water in view? Static views only; a moving camera and
 * the hook's per-frame cost are not measured here.
 */
const WATER_LOD_SPIKE_CULL_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-cull',
  version: 1,
  title: 'Water LOD spike w2: the selector cover hook, water under land taking no leaf budget',
  purpose: 'performance',
  scenarios: [
    { id: 'coast-200m', label: 'Coast from 200 m', view: { position: [0, 200, 600], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'coast-grazing-2m', label: 'Coast, grazing from 2 m', view: { position: [0, 2, 800], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'down-800m', label: 'Looking down from 800 m', view: { position: [0, 800, -600], target: [0, 0, -600] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'islands-5km', label: 'Islands from 5 km', view: { position: [0, 5000, 9000], target: [3000, 0, -1000] } as WaterLodSpikeView, expect: 'shore' as const },
    { id: 'open-sea-200m', label: 'Open sea from 200 m', view: { position: [-30000, 200, 30000], target: [-30000, 0, 45000] } as WaterLodSpikeView, expect: 'open-sea' as const },
  ].flatMap(({ id, label, view, expect }) =>
    [false, true].map((cull) => ({
      id: `${id}-${cull ? 'cull' : 'no-cull'}`,
      label: `${label}, ${cull ? 'cull on' : 'cull off'}`,
      settings: { wireframe: false, measure: 'cull' as const, land: true, cull, landExpect: expect, view },
      durationMs: 4000,
      warmupMs: 1500,
    })),
  ),
};

/** The wave times (s) the shore gate samples the water at. */
const SHORE_AUDIT_TIMES_S = [0, 7.3, 12.5, 31.9];

/**
 * Plan 080 shoreline review (ER 080, 2026-11-02): where does the water stand above the land? The gate is written before the
 * first run. At every dry point of a 5 km grid around the islands (land above the sea level, 25 m apart) the water surface the
 * water body would draw (waves at four times, and the detail noise when it is on) is compared with the land.
 *
 * Arms: detail noise on or off, shore weight on or off. Gates:
 * - the control: with the shore weight off, the water stands above the land at some dry point (else the gate cannot see a crescent);
 * - noise off and shore weight on: no dry point has water above the land by more than 5 cm;
 * - the water draws (the page is not frozen).
 *
 * Reported, not gated: the dry points, the violation count, the largest and the mean excess, and the same with the noise on,
 * which says how much of the crescent is the water body's detail noise and how much the waves.
 */
const WATER_LOD_SPIKE_SHORE_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-shore',
  version: 1,
  title: 'Water LOD spike shoreline review: water standing above the land, with and without the water depth weight',
  purpose: 'functional',
  scenarios: [
    { id: 'noise-on-weight-off', noise: true, shore: false },
    { id: 'noise-off-weight-off', noise: false, shore: false },
    { id: 'noise-on-weight-on', noise: true, shore: true },
    { id: 'noise-off-weight-on', noise: false, shore: true },
  ].map(({ id, noise, shore }) => ({
    id,
    label: `Detail noise ${noise ? 'on' : 'off'}, depth weight ${shore ? 'on' : 'off'}`,
    settings: {
      wireframe: false,
      measure: 'shore' as const,
      land: true,
      waterNoise: noise,
      shore,
      view: { position: [0, 200, 600], target: [0, 0, -600] } as WaterLodSpikeView,
    },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/**
 * Plan 080 shoreline review, experiment 4 (ER 080, 2026-11-02): foam and water colour from the water depth D. The gate is
 * written before the first run.
 *
 * CPU gate over the 5 km audit grid, the page's own look functions against the land:
 * - the waterline foam has no gap: every water point within half the edge width of the waterline has foam of at least one half;
 * - no foam deeper than the breaker zone;
 * - the water is more shallow-coloured within 2 m of the waterline than it is in deep water, by at least 0.3.
 *
 * GPU gate on the coast view (a frame read each, same wave time): foam alone raises the frame's mean luminance by at least one
 * level (of 255), and depth colour alone changes it by at least a quarter of a level. Both looks are off in the reference frame,
 * so the page's other settings cannot move it.
 *
 * Reported, not gated: the share of foam-white pixels (over 225 of 255) and the mean luminance of each frame.
 */
const WATER_LOD_SPIKE_SHORE_LOOK_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-shore-look',
  version: 1,
  title: 'Water LOD spike shoreline review: foam and water colour from the water depth',
  purpose: 'functional',
  scenarios: [
    {
      id: 'coast-view',
      label: 'Coast: foam and depth colour against the land',
      settings: {
        wireframe: false,
        measure: 'shore-look' as const,
        land: true,
        waterNoise: false,
        shore: true,
        view: { position: [300, 50, 500], target: [0, 5, -150] } as WaterLodSpikeView,
      },
      durationMs: 1000,
      warmupMs: 500,
    },
  ],
};

/**
 * Plan 080 shoreline review, experiment 5 (ER 080, 2026-11-02): the water reads the terrain's own baked height texture (the
 * library's plane bake, 49 m texels) instead of the analytic islands. The gate is written before the first run.
 *
 * Correctness (CPU, the 5 km audit grid at 25 m): the water depth from the texture is within 0.25 m of the analytic depth
 * everywhere, and no point more than 1 m from the waterline changes between wet and dry.
 *
 * No crescents (CPU, as the shore suite): with the baked read, noise off and the shore weight on, no dry point of the baked land
 * has water above it (tolerance 5 cm).
 *
 * Same picture (GPU, coast view, waves frozen): the frame with the baked read differs from the analytic frame by under 1.5
 * levels of luminance on average, and under 0.5 % of pixels differ by more than 24 levels. The land body draws the texture's
 * own texels in the baked frame, so this also shows the land the player sees and the land the water reads are one.
 *
 * Cost (GPU timestamps, coast view, analytic / baked / analytic / baked, 3 s each after warm-up): the baked read costs at most
 * 25 % more GPU time per frame than the analytic one. Reported as well: both means, the difference, the texel size, the
 * texture's size and the bake time.
 */
const WATER_LOD_SPIKE_TERRAIN_READ_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-terrain-read',
  version: 1,
  title: 'Water LOD spike shoreline review: the water reads the terrain texture',
  purpose: 'performance',
  scenarios: [
    {
      id: 'coast-view',
      label: 'Coast: baked terrain read against the analytic islands',
      settings: {
        wireframe: false,
        measure: 'terrain-read' as const,
        land: true,
        waterNoise: false,
        shore: true,
        view: { position: [300, 50, 500], target: [0, 5, -150] } as WaterLodSpikeView,
      },
      durationMs: 1000,
      warmupMs: 500,
    },
  ],
};

/**
 * v2 renders the same case at three times the page's pixel ratio. v1's first run passed every correctness check but could not
 * resolve the cost: the coast view takes about 1 ms of GPU time and the timestamp queries step in 0.1 ms, so both reads showed
 * exactly 1.00 ms. The read is per pixel, so nine times the pixels makes it nine times larger against the timer step. The gates
 * are v1's.
 */
const WATER_LOD_SPIKE_TERRAIN_READ_V2: TestSuite<WaterLodSpikeTestSettings> = {
  ...WATER_LOD_SPIKE_TERRAIN_READ_V1,
  version: 2,
  title: 'Water LOD spike shoreline review: the water reads the terrain texture (at 3x pixel ratio)',
  scenarios: WATER_LOD_SPIKE_TERRAIN_READ_V1.scenarios.map((scenario) => ({
    ...scenario,
    settings: { ...scenario.settings, pixelRatio: 3 },
  })),
};

/**
 * A picture review of the coast at the same view and wave time: the analytic islands and the baked terrain at the top tier, then the
 * baked terrain at High and at Low. It exists so the owner can see, without opening the page, that the baked read looks the same and
 * what a quality change does to the coast. Each case keeps one still (case thumbnail); the gates are only that the water and the land
 * draw. The pictures are the evidence, and a review is recorded only after someone looks at them.
 */
const WATER_LOD_SPIKE_COAST_LOOK_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-coast-look',
  version: 1,
  title: 'Water LOD spike shoreline review: the coast, analytic and baked terrain across quality tiers',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    ['ultra-analytic', 'Ultra, analytic islands', 'ultra', false, 0],
    ['ultra-baked', 'Ultra, baked terrain', 'ultra', true, 0],
    ['high-baked', 'High, baked terrain', 'high', true, 0],
    ['low-baked', 'Low, baked terrain', 'low', true, 0],
    ['orbit-ultra-baked', 'Ultra, baked terrain: camera orbit (clip)', 'ultra', true, 90],
    ['orbit-high-baked', 'High, baked terrain: camera orbit (clip)', 'high', true, 90],
  ].map(([id, label, quality, bakedTerrain, orbitDegrees]) => ({
    id: id as string,
    label: label as string,
    settings: {
      wireframe: false,
      measure: 'coast-look' as const,
      land: true,
      waterNoise: false,
      shore: true,
      quality: quality as WaterLodSpikeQualityId,
      bakedTerrain: bakedTerrain as boolean,
      ...(orbitDegrees ? { orbitDegrees: orbitDegrees as number } : {}),
      view: { position: [300, 50, 500], target: [0, 5, -150] } as WaterLodSpikeView,
    },
    durationMs: orbitDegrees ? 5000 : 1000,
    warmupMs: 500,
  })),
};

/**
 * Plan 080 shoreline review, the cost question behind "baked terrain takes a bit more performance" (ER 080, 2026-11-03). The
 * terrain-read suite flips the land body and the water's depth read together, and the analytic land body draws about twice the
 * triangles of the baked one (no per-node height range), so its cost cannot say what the read itself costs. This suite flips the two
 * apart: four arms, the land body from the analytic islands or the baked texture, and the water's depth read from either, so every
 * comparison of the read holds the land body (and with it the triangle count) fixed. The gate is written before the first run.
 *
 * Cost (GPU timestamps, 3x pixel ratio so the frame is far above the 0.1 ms timer step; the arms run in two rounds in opposite
 * order, 3 s each after warm-up):
 * - every arm's mean GPU frame is at least 0.5 ms, five timer steps (below that the suite cannot resolve a difference and says so);
 * - on each land body the baked read costs at most 10 % more GPU time than the analytic read.
 *
 * Reported, not gated: the four means, the read's cost on each land body, the land body's cost on each read, and the triangles of
 * each arm (the confound the comparison removes).
 */
const WATER_LOD_SPIKE_TERRAIN_COST_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-terrain-cost',
  version: 1,
  title: 'Water LOD spike shoreline review: what the baked depth read costs, land body held fixed',
  purpose: 'performance',
  scenarios: (
    [
      ['coast-view', 'Coast view, 3x pixel ratio', { position: [300, 50, 500], target: [0, 5, -150] }],
      ['down-800m', 'Looking down from 800 m, 3x pixel ratio', { position: [0, 800, -600], target: [0, 0, -600] }],
    ] as const satisfies readonly (readonly [string, string, WaterLodSpikeView])[]
  ).map(([id, label, view]) => ({
    id,
    label,
    settings: {
      wireframe: false,
      measure: 'terrain-cost' as const,
      land: true,
      waterNoise: false,
      shore: true,
      pixelRatio: 3,
      view,
    },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/**
 * Version 2 of the cost suite: same arms, views and gates, and each arm also reports its CPU frame (the FPS panel's figure) and what
 * the switch into it did to the page (the longest frame, and the time until the land body draws again), for a cost that is not GPU time.
 */
const WATER_LOD_SPIKE_TERRAIN_COST_V2: TestSuite<WaterLodSpikeTestSettings> = { ...WATER_LOD_SPIKE_TERRAIN_COST_V1, version: 2 };

const MOTION_COAST_VIEW: WaterLodSpikeView = { position: [300, 50, 500], target: [0, 5, -150] };
const MOTION_ORBIT_120: readonly WaterLodSpikeMotionKey[] = [
  { at: 0, azimuthDeg: 0, distance: 1, pan: [0, 0] },
  { at: 1, azimuthDeg: 120, distance: 1, pan: [0, 0] },
];
/** Zoom in to 0.4 of the distance, pan 200 m along x, then pull back out and pan home. */
const MOTION_ZOOM_PAN: readonly WaterLodSpikeMotionKey[] = [
  { at: 0, azimuthDeg: 0, distance: 1, pan: [0, 0] },
  { at: 0.25, azimuthDeg: 0, distance: 0.4, pan: [0, 0] },
  { at: 0.5, azimuthDeg: 0, distance: 0.4, pan: [200, 0] },
  { at: 0.75, azimuthDeg: 0, distance: 1, pan: [200, 0] },
  { at: 1, azimuthDeg: 0, distance: 1, pan: [0, 0] },
];

/**
 * Plan 080 shoreline review: a clip for the owner's report that the waves, the wave crescent and the terrain seem to move with the
 * camera after switching to Low and rotating. It exists so that someone can watch the bug rather than describe it, and says nothing
 * about it by itself: the gates are only that the water and the land draw and the page keeps rendering, and a review is recorded after
 * someone looks at the clips. Every case is the coast view with the island on and the baked terrain, the waves animating, and the camera
 * moved through the page's own orbit controls (the other clip suite holds the camera and freezes the waves). Each clip writes the
 * active quality tier in its top-left corner. The cases:
 * - ultra-orbit: orbit 120 degrees at Ultra, the reference for what the coast looks like turning (the water and island stay put);
 * - switch-low-then-orbit: Ultra, switch to Low a fifth of the way in, then orbit 120 degrees (the report's sequence);
 * - low-orbit: orbit 120 degrees at Low from the start;
 * - ultra-zoom-pan and low-zoom-pan: zoom in, pan, zoom out and pan back, at Ultra and at Low;
 * - quality-sweep-orbit: orbit 160 degrees while the quality steps down (High, Medium, Low) every quarter.
 * What to look for: the island and the wave pattern should stay where they are in the world as the camera moves, and the crescents on
 * the shore should not slide with the view. About a second of frozen or blank frames after a quality switch is the pipeline compiling.
 */
const WATER_LOD_SPIKE_CAMERA_QUALITY_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike-camera-quality',
  version: 1,
  title: 'Water LOD spike shoreline review: clips of the camera moving and the quality changing',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: (
    [
      ['ultra-orbit', 'Ultra: orbit 120 degrees', 'ultra', MOTION_ORBIT_120, undefined],
      [
        'switch-low-then-orbit',
        'Ultra, switch to Low, then orbit 120 degrees',
        'ultra',
        [
          { at: 0, azimuthDeg: 0, distance: 1, pan: [0, 0] },
          { at: 0.35, azimuthDeg: 0, distance: 1, pan: [0, 0] },
          { at: 1, azimuthDeg: 120, distance: 1, pan: [0, 0] },
        ],
        [{ at: 0.2, quality: 'low' }],
      ],
      ['low-orbit', 'Low: orbit 120 degrees', 'low', MOTION_ORBIT_120, undefined],
      ['ultra-zoom-pan', 'Ultra: zoom in, pan, zoom out, pan back', 'ultra', MOTION_ZOOM_PAN, undefined],
      ['low-zoom-pan', 'Low: zoom in, pan, zoom out, pan back', 'low', MOTION_ZOOM_PAN, undefined],
      [
        'quality-sweep-orbit',
        'Orbit 160 degrees while the quality steps from Ultra down to Low',
        'ultra',
        [
          { at: 0, azimuthDeg: 0, distance: 1, pan: [0, 0] },
          { at: 1, azimuthDeg: 160, distance: 1, pan: [0, 0] },
        ],
        [
          { at: 0.25, quality: 'high' },
          { at: 0.5, quality: 'medium' },
          { at: 0.75, quality: 'low' },
        ],
      ],
    ] as const satisfies readonly (readonly [string, string, WaterLodSpikeQualityId, readonly WaterLodSpikeMotionKey[], WaterLodSpikeMotion['qualityAt']])[]
  ).map(([id, label, quality, keys, qualityAt]) => ({
    id,
    label,
    settings: {
      wireframe: false,
      measure: 'camera-quality' as const,
      land: true,
      waterNoise: false,
      shore: true,
      quality,
      bakedTerrain: true,
      motion: { view: MOTION_COAST_VIEW, keys, ...(qualityAt ? { qualityAt } : {}) },
    },
    durationMs: 7000,
    // The quality and terrain switches of the case compile pipelines; that happens before the clip starts.
    warmupMs: 3000,
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
  WATER_LOD_SPIKE_PRECISION_V1,
  WATER_LOD_SPIKE_LAND_V1,
  WATER_LOD_SPIKE_CULL_V1,
  WATER_LOD_SPIKE_SHORE_V1,
  WATER_LOD_SPIKE_SHORE_LOOK_V1,
  WATER_LOD_SPIKE_TERRAIN_READ_V1,
  WATER_LOD_SPIKE_TERRAIN_READ_V2,
  WATER_LOD_SPIKE_COAST_LOOK_V1,
  WATER_LOD_SPIKE_TERRAIN_COST_V1,
  WATER_LOD_SPIKE_TERRAIN_COST_V2,
  WATER_LOD_SPIKE_CAMERA_QUALITY_V1,
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

async function measurePrecision(host: WaterLodSpikeTestHost): Promise<TestObservation> {
  const report = await host.runPrecisionProbe();
  const rad = (name: string, source: string, value: number) => ({ name, unit: 'rad', source, samples: [value] });
  const metrics = report.cases.flatMap((entry) => {
    const at = `t = ${entry.timeS} s`;
    return [
      rad(`phase error, anchor, ${at}`, 'GPU kernel readback', entry.gpuAnchor.maxRad),
      rad(`phase error, naive, ${at}`, 'GPU kernel readback', entry.gpuNaive.maxRad),
      rad(`phase error rms, anchor, ${at}`, 'GPU kernel readback', entry.gpuAnchor.rmsRad),
      rad(`phase error, anchor, float32 emulation, ${at}`, 'CPU emulation', entry.emulatedAnchor.maxRad),
      rad(`phase error, naive, float32 emulation, ${at}`, 'CPU emulation', entry.emulatedNaive.maxRad),
      { name: `sine error, anchor, ${at}`, unit: 'amplitude fraction', source: 'GPU kernel readback', samples: [entry.gpuAnchorSineError] },
      { name: `worst wavelength, anchor, ${at}`, unit: 'm', source: 'GPU kernel readback', samples: [entry.gpuAnchor.worstWavelengthM] },
      { name: `worst distance, anchor, ${at}`, unit: 'm', source: 'GPU kernel readback', samples: [entry.gpuAnchor.worstDistanceM] },
    ];
  });
  return {
    metrics: [...metrics, { name: 'wave and sample pairs judged', unit: 'pairs', source: 'GPU kernel readback', samples: [report.cases[0]?.gpuAnchor.pairs ?? 0] }],
    checks: [
      { name: 'ran on the WebGPU backend', passed: report.backend === 'webgpu', detail: `backend ${report.backend}` },
      { name: 'pairs judged', passed: (report.cases[0]?.gpuAnchor.pairs ?? 0) >= 1000, detail: `${report.cases[0]?.gpuAnchor.pairs ?? 0} pairs, ${report.waves} waves, ${report.samples} points` },
      ...report.cases.flatMap((entry) => [
        {
          name: `Q5 anchor-relative phase within ${MAX_PHASE_ERROR_RAD} rad at t = ${entry.timeS} s`,
          passed: entry.gpuAnchor.maxRad <= MAX_PHASE_ERROR_RAD,
          detail: `${entry.gpuAnchor.maxRad.toExponential(2)} rad, worst wave ${entry.gpuAnchor.worstWavelengthM.toFixed(2)} m at ${entry.gpuAnchor.worstDistanceM.toFixed(0)} m`,
        },
        {
          name: `Q5 control: the naive path misses by at least ${CONTROL_MIN_ERROR_RAD} rad at t = ${entry.timeS} s`,
          passed: entry.gpuNaive.maxRad >= CONTROL_MIN_ERROR_RAD,
          detail: `${entry.gpuNaive.maxRad.toExponential(2)} rad, worst wave ${entry.gpuNaive.worstWavelengthM.toFixed(2)} m at ${entry.gpuNaive.worstDistanceM.toFixed(0)} m`,
        },
      ]),
    ],
  };
}

async function measureLand(
  host: WaterLodSpikeTestHost,
  scenario: { readonly settings: WaterLodSpikeTestSettings; readonly durationMs: number },
  context: TestContext,
): Promise<TestObservation> {
  const wantLand = scenario.settings.land === true;
  // The land body compiles its pipeline while hidden; wait for it to draw, then let the selection settle on the view.
  for (let waited = 0; wantLand && !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const frames = await measureFrames(host, scenario.durationMs, context, true);
  const leaves = host.landLeaves();
  const share = leaves.drawn > 0 ? leaves.dryDrawn / leaves.drawn : 0;
  const expect = scenario.settings.landExpect;
  const count = (name: string, source: string, value: number) => ({ name, unit: 'leaves', source, samples: [value] });
  return {
    metrics: [
      ...frames.metrics,
      count('drawn water leaves', 'water selector', leaves.drawn),
      count('selected water leaves (the cap is 4096)', 'water selector', leaves.leaves),
      count('water leaves under land (conservative test)', 'water selector, CPU', leaves.dryDrawn),
      { name: 'water leaves under land, share of drawn', unit: 'fraction', source: 'water selector, CPU', samples: [share] },
      count('leaves the centre-only control calls dry', 'water selector, CPU', leaves.dryDrawnByCentre),
      count('leaves the control calls dry that hold water', 'water selector, CPU', leaves.centreWrongCalls),
    ],
    checks: [
      ...(frames.checks ?? []),
      { name: 'land drawn when asked', passed: !wantLand || host.landDrawn(), detail: `land ${wantLand ? 'on' : 'off'}, drawn ${host.landDrawn()}` },
      {
        name: 'conservative test calls no wet leaf dry',
        passed: leaves.conservativeWrongCalls === 0,
        detail: `${leaves.conservativeWrongCalls} wrong calls in ${leaves.drawn} drawn leaves`,
      },
      ...(expect === 'shore'
        ? [{ name: 'control: the centre-only test calls wet leaves dry', passed: leaves.centreWrongCalls > 0, detail: `${leaves.centreWrongCalls} wrong calls` }]
        : []),
      ...(expect === 'open-sea' ? [{ name: 'open sea has no leaf under land', passed: leaves.dryDrawn === 0, detail: `${leaves.dryDrawn} leaves` }] : []),
    ],
  };
}

async function measureCull(
  host: WaterLodSpikeTestHost,
  scenario: { readonly settings: WaterLodSpikeTestSettings; readonly durationMs: number },
  context: TestContext,
): Promise<TestObservation> {
  const wantCull = scenario.settings.cull === true;
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const frames = await measureFrames(host, scenario.durationMs, context, true);
  const drawn = host.landLeaves(true);
  const audit = host.landAudit();
  const expect = scenario.settings.landExpect;
  const count = (name: string, source: string, value: number) => ({ name, unit: 'leaves', source, samples: [value] });
  return {
    metrics: [
      ...frames.metrics,
      count('drawn water leaves', 'water selector', drawn.drawn),
      count('selected water leaves (the cap is 4096)', 'water selector', drawn.leaves),
      count('leaves the cover hook hid', 'water selector, stats.covered', drawn.covered),
      count('nodes still wanting to split (unmet)', 'water selector, stats.unmet', drawn.unmet),
      count('deepest level', 'water selector', drawn.deepestLevel),
      count('drawn leaves entirely under land', 'water selector, CPU', drawn.dryDrawn),
      { name: 'mean edge of the drawn leaves that hold water', unit: 'm', source: 'water selector, CPU', samples: [drawn.wetEdgeMeanM] },
    ],
    checks: [
      ...(frames.checks ?? []),
      { name: 'land drawn', passed: host.landDrawn(), detail: `drawn ${host.landDrawn()}` },
      { name: 'cover hook installed exactly when asked', passed: host.coverActive() === wantCull, detail: `asked ${wantCull}, installed ${host.coverActive()}` },
      {
        name: 'no leaf the hook test calls dry has a wet point',
        passed: audit.conservativeWrongCalls === 0,
        detail: `${audit.conservativeWrongCalls} wrong calls in ${audit.checked} selected leaves`,
      },
      ...(wantCull && expect === 'shore'
        ? [
            { name: 'the hook covered leaves', passed: drawn.covered > 0, detail: `${drawn.covered} covered` },
            { name: 'no drawn leaf lies entirely under land', passed: drawn.dryDrawn === 0, detail: `${drawn.dryDrawn} drawn leaves under land` },
          ]
        : []),
      ...(wantCull && expect === 'open-sea' ? [{ name: 'open sea: the hook covers nothing', passed: drawn.covered === 0, detail: `${drawn.covered} covered` }] : []),
      ...(!wantCull ? [{ name: 'no hook: nothing is covered', passed: drawn.covered === 0, detail: `${drawn.covered} covered` }] : []),
    ],
  };
}

/** Largest excess (m) the water may stand above the land at a dry point before the shore gate calls it a crescent. */
const SHORE_TOLERANCE_M = 0.05;

/**
 * The arms of a shore suite run one after another on one page, so the control ("the gate can see a crescent") is judged on this
 * case's own numbers: a case with the weight off reports it, a case with the weight on and noise off must be clean.
 */
async function measureShore(
  host: WaterLodSpikeTestHost,
  scenario: { readonly settings: WaterLodSpikeTestSettings },
  context: TestContext,
): Promise<TestObservation> {
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const audit = host.shoreAudit(SHORE_AUDIT_TIMES_S);
  const counts = host.counts();
  const wantClean = scenario.settings.shore === true && scenario.settings.waterNoise === false;
  const wantSeen = scenario.settings.shore === false;
  return {
    metrics: [
      { name: 'dry grid points', unit: 'points', source: 'CPU grid, 25 m', samples: [audit.dryPoints] },
      { name: 'dry points with water above the land (mean over the times)', unit: 'points', source: 'CPU, body heightAt', samples: [audit.violations] },
      { name: 'largest height of water over land', unit: 'm', source: 'CPU, body heightAt', samples: [audit.maxExcessM] },
      { name: 'mean height of water over land at the violations', unit: 'm', source: 'CPU, body heightAt', samples: [audit.meanExcessM] },
    ],
    checks: [
      { name: 'water body draws', passed: counts.drawCalls > 0, detail: `draw calls ${counts.drawCalls}` },
      { name: 'the grid has dry points', passed: audit.dryPoints > 0, detail: `${audit.dryPoints} points` },
      ...(wantSeen
        ? [{ name: 'control: with the weight off the water stands above the land somewhere', passed: audit.violations > 0, detail: `${audit.violations} points, worst ${audit.maxExcessM.toFixed(2)} m` }]
        : []),
      ...(wantClean
        ? [{ name: `noise off, weight on: no dry point has water more than ${SHORE_TOLERANCE_M * 100} cm above the land`, passed: audit.violations === 0, detail: `${audit.violations} points, worst ${audit.maxExcessM.toFixed(3)} m` }]
        : []),
    ],
  };
}

/** Luminance (0..255, encoded) above which a pixel counts as foam-white: the foam colour is about 244, the sky reflection about 195, deep water far below. Reported only: foam also covers the glint's own bright pixels. */
const FOAM_BRIGHT_LUMINANCE = 225;
/** Smallest rise of the frame's mean luminance (0..255 levels) the foam must make in the coast view (the first look measured about 9). */
const FOAM_MIN_MEAN_RISE = 1;
/** Smallest difference in deepness between the water at the waterline and the deep water. */
const DEPTH_COLOUR_MIN_SPAN = 0.3;
/** Smallest change of the frame's mean luminance (0..255 levels) the depth colour must make in the coast view. */
const DEPTH_COLOUR_MIN_MEAN_CHANGE = 0.25;

function frameStats(image: ILuminanceImage): { readonly brightShare: number; readonly mean: number } {
  let bright = 0;
  let sum = 0;
  for (const value of image.values) {
    if (value > FOAM_BRIGHT_LUMINANCE) bright++;
    sum += value;
  }
  return { brightShare: bright / image.values.length, mean: sum / image.values.length };
}

async function measureShoreLook(
  host: WaterLodSpikeTestHost,
  scenario: { readonly settings: WaterLodSpikeTestSettings },
  context: TestContext,
): Promise<TestObservation> {
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const frame = async (foam: boolean, colour: boolean) => {
    host.setFoam(foam);
    host.setDepthColour(colour);
    await host.waitFrames(5, context);
    return frameStats(host.readFrame(0, 0));
  };
  const reference = await frame(false, false);
  const withFoam = await frame(true, false);
  const withColour = await frame(false, true);
  const audit = host.shoreLookAudit();
  const counts = host.counts();
  const foamRise = withFoam.mean - reference.mean;
  const meanChange = Math.abs(withColour.mean - reference.mean);
  const span = audit.deepDeepness - audit.shallowDeepness;
  return {
    metrics: [
      { name: 'water grid points', unit: 'points', source: 'CPU grid, 25 m', samples: [audit.wetPoints] },
      { name: 'points at the waterline', unit: 'points', source: 'CPU grid, within half the edge width', samples: [audit.edgePoints] },
      { name: 'waterline points without foam', unit: 'points', source: 'CPU, page look', samples: [audit.edgeGaps] },
      { name: 'foam points deeper than the breaker zone', unit: 'points', source: 'CPU, page look', samples: [audit.farFoam] },
      { name: 'deepness at the waterline', unit: 'ratio', source: 'CPU, page look', samples: [audit.shallowDeepness] },
      { name: 'deepness in deep water', unit: 'ratio', source: 'CPU, page look', samples: [audit.deepDeepness] },
      { name: 'bright pixel share, no foam', unit: 'ratio', source: 'canvas readback', samples: [reference.brightShare] },
      { name: 'bright pixel share, foam', unit: 'ratio', source: 'canvas readback', samples: [withFoam.brightShare] },
      { name: 'mean luminance, foam', unit: 'levels', source: 'canvas readback, 0..255', samples: [withFoam.mean] },
      { name: 'mean luminance, no depth colour', unit: 'levels', source: 'canvas readback, 0..255', samples: [reference.mean] },
      { name: 'mean luminance, depth colour', unit: 'levels', source: 'canvas readback, 0..255', samples: [withColour.mean] },
    ],
    checks: [
      { name: 'water body draws', passed: counts.drawCalls > 0, detail: `draw calls ${counts.drawCalls}` },
      { name: 'the grid has waterline points', passed: audit.edgePoints > 0, detail: `${audit.edgePoints} points` },
      { name: 'the foam has no gap along the waterline', passed: audit.edgeGaps === 0, detail: `${audit.edgeGaps} of ${audit.edgePoints} points` },
      { name: 'no foam deeper than the breaker zone', passed: audit.farFoam === 0, detail: `${audit.farFoam} points` },
      { name: `the water is lighter at the waterline than in deep water (by ${DEPTH_COLOUR_MIN_SPAN})`, passed: span >= DEPTH_COLOUR_MIN_SPAN, detail: `span ${span.toFixed(3)}` },
      { name: `foam brightens the coast view (mean luminance up by at least ${FOAM_MIN_MEAN_RISE} level)`, passed: foamRise >= FOAM_MIN_MEAN_RISE, detail: `mean luminance up by ${foamRise.toFixed(3)} levels` },
      { name: 'depth colour changes the coast frame', passed: meanChange >= DEPTH_COLOUR_MIN_MEAN_CHANGE, detail: `mean luminance changes by ${meanChange.toFixed(3)} levels` },
    ],
  };
}

/** Largest difference between the baked and the analytic water depth, metres (the 49 m texel's bilinear error on these islands is about 0.1 m). */
const TERRAIN_READ_MAX_DEPTH_ERROR_M = 0.25;
/** Largest mean luminance difference (0..255 levels) between the analytic frame and the baked frame. */
const TERRAIN_READ_MAX_MEAN_DIFF = 1.5;
/** A pixel counts as different from this many levels; at most {@link TERRAIN_READ_MAX_DIFF_SHARE} of them may. */
const TERRAIN_READ_DIFF_LEVELS = 24;
const TERRAIN_READ_MAX_DIFF_SHARE = 0.005;
/** The baked read may cost at most this multiple of the analytic read's GPU frame time. */
const TERRAIN_READ_MAX_COST_RATIO = 1.25;
const TERRAIN_READ_COST_WARMUP_MS = 1500;
const TERRAIN_READ_COST_SAMPLES = 3;

const mean = (values: readonly number[]): number => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN);

/** Waits for the land body to be drawn again after the heights it draws changed (the body is rebuilt), then lets the frame settle. */
async function settleTerrain(host: WaterLodSpikeTestHost, context: TestContext): Promise<void> {
  await host.waitFrames(5, context);
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
}

/** Sweeps the camera `degrees` around the view's target at the view's radius and height, one step per frame, over `durationMs`. */
async function orbitView(host: WaterLodSpikeTestHost, view: WaterLodSpikeView, degrees: number, durationMs: number, context: TestContext): Promise<void> {
  const [px, py, pz] = view.position;
  const [tx, , tz] = view.target;
  const radius = Math.hypot(px - tx, pz - tz);
  const startAngle = Math.atan2(pz - tz, px - tx);
  const started = performance.now();
  for (let elapsed = 0; elapsed < durationMs; elapsed = performance.now() - started) {
    const angle = startAngle + (degrees * Math.PI / 180) * (elapsed / durationMs);
    host.setView({ position: [tx + radius * Math.cos(angle), py, tz + radius * Math.sin(angle)], target: view.target });
    await host.waitFrames(1, context);
  }
  host.setView(view);
}

/**
 * A picture case: waits for the land body to draw after the case's quality and terrain switches, lets the frame settle, and checks that
 * the water and the land are drawn. The case thumbnail taken after this is the evidence.
 */
async function measureCoastLook(host: WaterLodSpikeTestHost, scenario: { readonly durationMs: number; readonly settings: WaterLodSpikeTestSettings }, context: TestContext): Promise<TestObservation> {
  await settleTerrain(host, context);
  const { orbitDegrees, view } = scenario.settings;
  if (orbitDegrees && view) await orbitView(host, view, orbitDegrees, scenario.durationMs, context);
  const frames = await measureFrames(host, orbitDegrees ? 500 : scenario.durationMs, context, true);
  return {
    ...frames,
    checks: [...(frames.checks ?? []), { name: 'land drawn', passed: host.landDrawn(), detail: `drawn ${host.landDrawn()}` }],
  };
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** The camera pose `progress` (0 to 1) along a motion case's path: eased between the two keys around it. */
export function motionPose(motion: WaterLodSpikeMotion, progress: number): WaterLodSpikeView {
  const keys = motion.keys;
  const at = Math.min(1, Math.max(0, progress));
  let next = keys.findIndex((key) => key.at >= at);
  if (next < 0) next = keys.length - 1;
  const to = keys[next];
  const from = keys[Math.max(0, next - 1)];
  const span = to.at - from.at;
  const t = span > 0 ? smoothstep((at - from.at) / span) : 1;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const azimuth = (lerp(from.azimuthDeg, to.azimuthDeg) * Math.PI) / 180;
  const distance = lerp(from.distance, to.distance);
  const target: [number, number, number] = [
    motion.view.target[0] + lerp(from.pan[0], to.pan[0]),
    motion.view.target[1],
    motion.view.target[2] + lerp(from.pan[1], to.pan[1]),
  ];
  const { position, target: base } = motion.view;
  const [ox, oy, oz] = [position[0] - base[0], position[1] - base[1], position[2] - base[2]];
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  return {
    position: [target[0] + (ox * cos - oz * sin) * distance, target[1] + oy * distance, target[2] + (ox * sin + oz * cos) * distance],
    target,
  };
}

/**
 * A clip case: the camera moves along the case's path through the page's orbit controls with the waves animating, and the quality
 * switches where the case says. Reports the frame times (the longest frame is the hitch of a quality switch, whose pipelines compile)
 * and checks only that the page kept rendering and that the water and the land are drawn at the end. The clip is the evidence.
 */
async function measureCameraQuality(host: WaterLodSpikeTestHost, scenario: { readonly durationMs: number; readonly settings: WaterLodSpikeTestSettings }, context: TestContext): Promise<TestObservation> {
  const motion = scenario.settings.motion;
  if (!motion) throw new Error('A camera-quality case needs a motion path');
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  const switches = [...(motion.qualityAt ?? [])];
  host.beginFrameSampling();
  host.setLiveCamera(motionPose(motion, 0));
  await host.waitFrames(2, context);
  const started = performance.now();
  for (let elapsed = 0; elapsed < scenario.durationMs; elapsed = performance.now() - started) {
    const progress = elapsed / scenario.durationMs;
    while (switches.length > 0 && switches[0].at <= progress) host.setQuality(switches.shift()?.quality ?? null);
    host.setLiveCamera(motionPose(motion, progress));
    await host.waitFrames(1, context);
  }
  host.setLiveCamera(motionPose(motion, 1));
  const frameMs = host.endFrameSampling();
  const cpuMs = host.takeCpuFrameMs();
  for (let waited = 0; !host.landDrawn() && waited < 5000; waited += 100) await context.wait(100);
  const { drawCalls } = host.counts();
  const longest = Math.max(0, ...frameMs);
  return {
    metrics: [
      { name: 'frame interval', unit: 'ms', source: 'engine.tick$ intervals', samples: [...frameMs] },
      { name: 'CPU frame', unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render)', samples: [...cpuMs] },
      { name: 'longest frame', unit: 'ms', source: 'engine.tick$ intervals', samples: [longest] },
    ],
    checks: [
      { name: 'water body draws', passed: drawCalls > 0, detail: `draw calls ${drawCalls}` },
      { name: 'land drawn after the path', passed: host.landDrawn(), detail: `drawn ${host.landDrawn()}` },
      { name: `the page kept rendering (at least ${CAMERA_QUALITY_MIN_FRAMES} frames over the clip)`, passed: frameMs.length >= CAMERA_QUALITY_MIN_FRAMES, detail: `${frameMs.length} frames, longest ${longest.toFixed(0)} ms` },
      { name: 'every quality switch was applied', passed: switches.length === 0, detail: `${switches.length} switches left` },
    ],
  };
}

/** Fewest frames a clip may show: a page that stalls for most of the clip (a pipeline that never compiles) fails. */
const CAMERA_QUALITY_MIN_FRAMES = 60;

/** The frame's mean luminance difference from `other`, and the share of pixels that differ by more than `levels`. */
function frameDifference(image: ILuminanceImage, other: ILuminanceImage, levels: number): { readonly meanDiff: number; readonly share: number } {
  let sum = 0;
  let over = 0;
  const count = Math.min(image.values.length, other.values.length);
  for (let n = 0; n < count; n++) {
    const diff = Math.abs(image.values[n] - other.values[n]);
    sum += diff;
    if (diff > levels) over++;
  }
  return { meanDiff: sum / count, share: over / count };
}

async function gpuMeanMs(host: WaterLodSpikeTestHost, context: TestContext): Promise<number> {
  await context.wait(TERRAIN_READ_COST_WARMUP_MS);
  const samples: number[] = [];
  for (let n = 0; n < TERRAIN_READ_COST_SAMPLES; n++) {
    await context.wait(1000);
    const sample = host.gpuFrameMs();
    if (sample !== null) samples.push(sample);
  }
  return mean(samples);
}

async function measureTerrainRead(host: WaterLodSpikeTestHost, context: TestContext): Promise<TestObservation> {
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const info = host.terrainReadInfo();
  const depth = host.terrainReadAudit();
  host.setBakedTerrain(false);
  await settleTerrain(host, context);
  const analyticFrame = host.readFrame(0, 0);
  const analyticMs = [await gpuMeanMs(host, context)];
  host.setBakedTerrain(true);
  await settleTerrain(host, context);
  const bakedFrame = host.readFrame(0, 0);
  const crescents = host.shoreAudit(SHORE_AUDIT_TIMES_S);
  const bakedMs = [await gpuMeanMs(host, context)];
  host.setBakedTerrain(false);
  await settleTerrain(host, context);
  analyticMs.push(await gpuMeanMs(host, context));
  host.setBakedTerrain(true);
  await settleTerrain(host, context);
  bakedMs.push(await gpuMeanMs(host, context));
  host.setBakedTerrain(null);
  const difference = frameDifference(bakedFrame, analyticFrame, TERRAIN_READ_DIFF_LEVELS);
  const analytic = mean(analyticMs);
  const baked = mean(bakedMs);
  const ratio = baked / analytic;
  const counts = host.counts();
  return {
    metrics: [
      { name: 'texture cell size', unit: 'm', source: 'bake layout', samples: [info.texelM] },
      { name: 'texture size', unit: 'MB', source: 'bake', samples: [info.megabytes] },
      { name: 'bake time', unit: 'ms', source: 'CPU, one bake', samples: [info.bakeMs] },
      { name: 'grid points compared', unit: 'points', source: 'CPU grid, 25 m', samples: [depth.points] },
      { name: 'largest depth error, baked against analytic', unit: 'm', source: 'CPU grid', samples: [depth.maxDepthErrorM] },
      { name: 'mean depth error', unit: 'm', source: 'CPU grid', samples: [depth.meanDepthErrorM] },
      { name: 'wet or dry flips (all)', unit: 'points', source: 'CPU grid', samples: [depth.signFlips] },
      { name: 'wet or dry flips more than 1 m from the waterline', unit: 'points', source: 'CPU grid', samples: [depth.clearFlips] },
      { name: 'dry points with water above the baked land', unit: 'points', source: 'CPU, body heightAt', samples: [crescents.violations] },
      { name: 'mean luminance difference, baked against analytic frame', unit: 'levels', source: 'canvas readback, 0..255', samples: [difference.meanDiff] },
      { name: `pixels differing by more than ${TERRAIN_READ_DIFF_LEVELS} levels`, unit: 'ratio', source: 'canvas readback', samples: [difference.share] },
      { name: 'GPU frame, analytic read', unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages', samples: analyticMs },
      { name: 'GPU frame, baked read', unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages', samples: bakedMs },
      { name: 'GPU frame, baked over analytic', unit: 'ratio', source: 'means of the two', samples: [ratio] },
    ],
    checks: [
      { name: 'water body draws', passed: counts.drawCalls > 0, detail: `draw calls ${counts.drawCalls}` },
      { name: 'the grid has waterline points', passed: depth.nearWaterline > 0, detail: `${depth.nearWaterline} points` },
      { name: `baked depth within ${TERRAIN_READ_MAX_DEPTH_ERROR_M} m of the analytic depth`, passed: depth.maxDepthErrorM <= TERRAIN_READ_MAX_DEPTH_ERROR_M, detail: `worst ${depth.maxDepthErrorM.toFixed(3)} m` },
      { name: 'no wet or dry flip more than 1 m from the waterline', passed: depth.clearFlips === 0, detail: `${depth.clearFlips} points (${depth.signFlips} flips in all)` },
      { name: 'no crescents with the baked read (noise off, weight on)', passed: crescents.violations === 0, detail: `${crescents.violations} of ${crescents.dryPoints} dry points, worst ${crescents.maxExcessM.toFixed(3)} m` },
      { name: `same picture: mean luminance within ${TERRAIN_READ_MAX_MEAN_DIFF} levels`, passed: difference.meanDiff <= TERRAIN_READ_MAX_MEAN_DIFF, detail: `${difference.meanDiff.toFixed(3)} levels` },
      { name: `same picture: under ${TERRAIN_READ_MAX_DIFF_SHARE * 100} % of pixels differ by over ${TERRAIN_READ_DIFF_LEVELS} levels`, passed: difference.share <= TERRAIN_READ_MAX_DIFF_SHARE, detail: `${(difference.share * 100).toFixed(3)} %` },
      { name: 'GPU time measured for both reads', passed: Number.isFinite(ratio), detail: `analytic ${analytic.toFixed(3)} ms, baked ${baked.toFixed(3)} ms` },
      { name: `the baked read costs at most ${Math.round((TERRAIN_READ_MAX_COST_RATIO - 1) * 100)} % more GPU time`, passed: ratio <= TERRAIN_READ_MAX_COST_RATIO, detail: `x${ratio.toFixed(3)} (${(baked - analytic).toFixed(3)} ms)` },
    ],
  };
}

/** Every arm's mean GPU frame must be at least this long (five steps of the 0.1 ms timestamp resolution) for a difference to be read. */
const TERRAIN_COST_MIN_FRAME_MS = 0.5;
/** On either land body the baked read may cost at most this multiple of the analytic read's GPU frame time. */
const TERRAIN_COST_MAX_READ_RATIO = 1.1;

/** One arm of the cost suite: where the land body and the water's depth read take their heights from. */
interface ITerrainCostArm {
  readonly id: string;
  readonly landBaked: boolean;
  readonly readBaked: boolean;
}

const TERRAIN_COST_ARMS: readonly ITerrainCostArm[] = [
  { id: 'analytic land, analytic read', landBaked: false, readBaked: false },
  { id: 'analytic land, baked read', landBaked: false, readBaked: true },
  { id: 'baked land, analytic read', landBaked: true, readBaked: false },
  { id: 'baked land, baked read', landBaked: true, readBaked: true },
];

/**
 * The four arms in two rounds, the second in the opposite order so a slow drift of the machine cancels in the mean. The land body is
 * rebuilt when its source changes, so the order keeps those switches few (three over the two rounds).
 */
async function measureTerrainCost(host: WaterLodSpikeTestHost, context: TestContext): Promise<TestObservation> {
  for (let waited = 0; !host.landDrawn() && waited < 60_000; waited += 100) await context.wait(100);
  await host.waitFrames(SETTLE_FRAMES, context);
  const [analyticAnalytic, analyticBaked, bakedAnalytic, bakedBaked] = TERRAIN_COST_ARMS;
  const order = [analyticAnalytic, analyticBaked, bakedAnalytic, bakedBaked, bakedBaked, bakedAnalytic, analyticBaked, analyticAnalytic];
  const gpuMs = new Map<ITerrainCostArm, number[]>(TERRAIN_COST_ARMS.map((arm) => [arm, []]));
  const triangles = new Map<ITerrainCostArm, number>();
  const cpuMs = new Map<ITerrainCostArm, number[]>(TERRAIN_COST_ARMS.map((arm) => [arm, []]));
  const hitchMs = new Map<ITerrainCostArm, number[]>(TERRAIN_COST_ARMS.map((arm) => [arm, []]));
  const drawnMs = new Map<ITerrainCostArm, number[]>(TERRAIN_COST_ARMS.map((arm) => [arm, []]));
  for (const arm of order) {
    host.beginFrameSampling();
    const flipped = performance.now();
    host.setBakedTerrain(arm.landBaked);
    host.setWaterRead(arm.readBaked);
    await host.waitFrames(2, context);
    while (!host.landDrawn() && performance.now() - flipped < 60_000) await host.waitFrames(1, context);
    drawnMs.get(arm)?.push(performance.now() - flipped);
    await settleTerrain(host, context);
    hitchMs.get(arm)?.push(Math.max(0, ...host.endFrameSampling()));
    host.takeCpuFrameMs();
    host.beginFrameSampling();
    gpuMs.get(arm)?.push(await gpuMeanMs(host, context));
    host.endFrameSampling();
    cpuMs.get(arm)?.push(mean(host.takeCpuFrameMs()));
    triangles.set(arm, host.counts().triangles);
  }
  host.setWaterRead(null);
  host.setBakedTerrain(null);
  const means = new Map(TERRAIN_COST_ARMS.map((arm) => [arm, mean(gpuMs.get(arm) ?? [])]));
  const at = (arm: ITerrainCostArm) => means.get(arm) ?? Number.NaN;
  const cpuAt = (arm: ITerrainCostArm) => mean(cpuMs.get(arm) ?? []);
  const readOnAnalyticLand = at(analyticBaked) - at(analyticAnalytic);
  const readOnBakedLand = at(bakedBaked) - at(bakedAnalytic);
  const landOnAnalyticRead = at(bakedAnalytic) - at(analyticAnalytic);
  const landOnBakedRead = at(bakedBaked) - at(analyticBaked);
  const ratioOnAnalyticLand = at(analyticBaked) / at(analyticAnalytic);
  const ratioOnBakedLand = at(bakedBaked) / at(bakedAnalytic);
  const shortest = Math.min(...TERRAIN_COST_ARMS.map(at));
  const draws = host.counts();
  return {
    metrics: [
      ...TERRAIN_COST_ARMS.map((arm) => ({ name: `GPU frame, ${arm.id}`, unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages', samples: gpuMs.get(arm) ?? [] })),
      ...TERRAIN_COST_ARMS.map((arm) => ({ name: `CPU frame, ${arm.id}`, unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render), mean over the GPU window', samples: cpuMs.get(arm) ?? [] })),
      ...TERRAIN_COST_ARMS.map((arm) => ({ name: `longest frame after the switch, ${arm.id}`, unit: 'ms', source: 'engine.tick$ intervals from the switch to the settled frame', samples: hitchMs.get(arm) ?? [] })),
      ...TERRAIN_COST_ARMS.map((arm) => ({ name: `time to a drawn land body after the switch, ${arm.id}`, unit: 'ms', source: 'performance.now, at least two frames', samples: drawnMs.get(arm) ?? [] })),
      ...TERRAIN_COST_ARMS.map((arm) => ({ name: `triangles, ${arm.id}`, unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles.get(arm) ?? Number.NaN] })),
      { name: 'CPU frame, baked read over analytic read, analytic land body', unit: 'ratio', source: 'means of two arms', samples: [cpuAt(analyticBaked) / cpuAt(analyticAnalytic)] },
      { name: 'CPU frame, baked read over analytic read, baked land body', unit: 'ratio', source: 'means of two arms', samples: [cpuAt(bakedBaked) / cpuAt(bakedAnalytic)] },
      { name: 'cost of the baked read, analytic land body', unit: 'ms', source: 'means of two arms', samples: [readOnAnalyticLand] },
      { name: 'cost of the baked read, baked land body', unit: 'ms', source: 'means of two arms', samples: [readOnBakedLand] },
      { name: 'cost of the baked land body, analytic read', unit: 'ms', source: 'means of two arms', samples: [landOnAnalyticRead] },
      { name: 'cost of the baked land body, baked read', unit: 'ms', source: 'means of two arms', samples: [landOnBakedRead] },
      { name: 'GPU frame, baked read over analytic read, analytic land body', unit: 'ratio', source: 'means of two arms', samples: [ratioOnAnalyticLand] },
      { name: 'GPU frame, baked read over analytic read, baked land body', unit: 'ratio', source: 'means of two arms', samples: [ratioOnBakedLand] },
    ],
    checks: [
      { name: 'water body draws', passed: draws.drawCalls > 0, detail: `draw calls ${draws.drawCalls}` },
      { name: 'CPU frame time measured in every arm', passed: TERRAIN_COST_ARMS.every((arm) => Number.isFinite(cpuAt(arm))), detail: TERRAIN_COST_ARMS.map((arm) => `${cpuAt(arm).toFixed(2)} ms`).join(', ') },
      { name: `every arm's GPU frame is at least ${TERRAIN_COST_MIN_FRAME_MS} ms, so a difference can be read`, passed: shortest >= TERRAIN_COST_MIN_FRAME_MS, detail: `shortest arm ${shortest.toFixed(3)} ms` },
      { name: `on the analytic land body the baked read costs at most ${Math.round((TERRAIN_COST_MAX_READ_RATIO - 1) * 100)} % more GPU time`, passed: ratioOnAnalyticLand <= TERRAIN_COST_MAX_READ_RATIO, detail: `x${ratioOnAnalyticLand.toFixed(3)} (${readOnAnalyticLand.toFixed(3)} ms)` },
      { name: `on the baked land body the baked read costs at most ${Math.round((TERRAIN_COST_MAX_READ_RATIO - 1) * 100)} % more GPU time`, passed: ratioOnBakedLand <= TERRAIN_COST_MAX_READ_RATIO, detail: `x${ratioOnBakedLand.toFixed(3)} (${readOnBakedLand.toFixed(3)} ms)` },
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
  const adapter = simpleAdapter<WaterLodSpikeTestSettings, boolean>({
    windowModes: false,
    capture: () => host.wireframe(),
    apply: (scenario) => {
      host.setWireframe(scenario.settings.wireframe);
      host.setView(scenario.settings.view ?? null);
      host.setPixelRatio(scenario.settings.pixelRatio ?? null);
      host.setQuality(scenario.settings.quality ?? null);
      host.setLand(scenario.settings.land ?? null);
      host.setCull(scenario.settings.cull ?? null);
      host.setWaterNoise(scenario.settings.waterNoise ?? null);
      host.setShore(scenario.settings.shore ?? null);
      host.setBakedTerrain(scenario.settings.bakedTerrain ?? null);
    },
    ...(host.thumbnail
      ? {
          thumbnail: async (_scenario: unknown, context: TestContext) => {
            if (context.repetition > 1) return undefined;
            const image = await host.thumbnail?.();
            return image ? [image] : undefined;
          },
        }
      : {}),
    restore: (wireframe) => {
      host.setWireframe(wireframe);
      host.setView(null);
      host.setLiveCamera(null);
      host.setPixelRatio(null);
      host.setQuality(null);
      host.setLand(null);
      host.setCull(null);
      host.setWaterNoise(null);
      host.setShore(null);
      host.setFoam(null);
      host.setDepthColour(null);
      host.setBakedTerrain(null);
      host.setWaterRead(null);
    },
    ready: async (context) => {
      while (!host.ready()) {
        await context.wait(100);
      }
    },
    environment: () => host.environment(),
    measure: async (scenario, context): Promise<TestObservation> => {
      if (scenario.settings.measure === 'aliasing') return measureAliasing(host, context, scenario.settings.gated ?? true);
      if (scenario.settings.measure === 'precision') return measurePrecision(host);
      if (scenario.settings.measure === 'land') return measureLand(host, scenario, context);
      if (scenario.settings.measure === 'cull') return measureCull(host, scenario, context);
      if (scenario.settings.measure === 'shore') return measureShore(host, scenario, context);
      if (scenario.settings.measure === 'shore-look') return measureShoreLook(host, scenario, context);
      if (scenario.settings.measure === 'terrain-read') return measureTerrainRead(host, context);
      if (scenario.settings.measure === 'coast-look') return measureCoastLook(host, scenario, context);
      if (scenario.settings.measure === 'terrain-cost') return measureTerrainCost(host, context);
      if (scenario.settings.measure === 'camera-quality') return measureCameraQuality(host, scenario, context);
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
  if (!host.recording) return adapter;
  // Only the cases that move the camera record: a still shows one view, a clip shows the camera moving over the same coast.
  return { ...adapter, recording: (scenario) => (scenario.settings.orbitDegrees || scenario.settings.motion ? host.recording?.(scenario.id) : undefined) };
}
