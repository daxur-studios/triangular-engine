import { simpleAdapter, type TestContext, type TestObservation, type TestRunAdapter, type TestScenario, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import type { WaterLodSpikeQualityId } from './core/water-lod-spike-quality';
import type { SpherePoseId } from './core/water-lod-spike-sphere-poses';

/** What a sphere water case sets and measures. */
export interface WaterLodSpikeSphereTestSettings {
  readonly pose: SpherePoseId;
  /**
   * `cost`: the layer arms. `split`: the water's own shading parts on the land. `density`: the water alone, mesh density and wave
   * work. `horizon`: the cull and the leaf cap. `stills`: one picture of the whole stack at one leaf cap (`leafCap`).
   */
  readonly measure: 'cost' | 'split' | 'density' | 'horizon' | 'stills' | 'water-alone';
  /** Stills suite: the water's leaf cap for this case. */
  readonly leafCap?: number;
  /** Water-alone suite (density v2): which setting this case holds, see {@link SPHERE_WATER_ALONE_ARMS}. */
  readonly arm?: SphereWaterAloneArmId;
}

/** The water-alone suite's settings: A the reference, B waves off, C half the drawn pixels, D four times the patches. */
export type SphereWaterAloneArmId = 'A' | 'B' | 'C' | 'D';

/** What of the water's cost is switched off or lowered in one split arm. */
export interface IWaterLodSpikeSphereVariant {
  /** True: the 3 x 3 quadrature over the lost slope covariance; false: one sample at the mean slope. */
  readonly quadrature: boolean;
  /** True: shore weight, foam and depth colour on (one analytic land read per pixel); false: none of them. */
  readonly depthRead: boolean;
  readonly quality: WaterLodSpikeQualityId;
  /** Density suite: the mesh inputs (`cellPixels`, `leafCap`) in place of the tier's, with the tier's wave filter bias kept. */
  readonly mesh?: { readonly cellPixels: number; readonly leafCap: number };
  /** Density suite: false turns every wave off in both stages (the vertex spacing filter and the fragment footprint gate drop them all), leaving the mesh and the plain shading. */
  readonly waves?: boolean;
  /** Density suite: replaces the tier's wave filter bias (`lodBias`). */
  readonly lodBias?: number;
  /**
   * Horizon suite: true draws only the leaves in front of the planet's horizon (`<planetTerrain [horizonCull]>`). A held variant
   * without it draws all of them, as the earlier suites measured, whatever the page's own switch says.
   */
  readonly horizon?: boolean;
  /**
   * Water-alone suite: the fraction of the page's drawn pixels to keep (0.5 halves them). The page lowers the renderer's pixel ratio
   * by the square root of it and hands the ratio back when the variant is released.
   */
  readonly pixelScale?: number;
}

/** What is switched on in one cost arm. */
export interface IWaterLodSpikeSphereLayers {
  readonly land: boolean;
  readonly water: boolean;
  readonly atmosphere: boolean;
}

/** What the page can tell a case about the layers. */
export interface WaterLodSpikeSphereTestHost {
  /** True once the engine has rendered frames. */
  ready(): boolean;
  /** Pixels in the drawing buffer now (width times height), for the water-alone suite's pixel check. */
  drawingBufferPixels?(): number;
  /** Holds the camera at the pose; null hands it back to the page's own. */
  setPose(id: SpherePoseId | null): void;
  /**
   * Puts the layers on or off: the land and the water bodies are added or removed (their meshes rebuild and compile when they
   * come back), the atmosphere is `enabled` or not (no recompile). Null restores the page's own settings.
   */
  setLayers(layers: IWaterLodSpikeSphereLayers | null): void;
  /**
   * Holds the water at a variant (split suite): quadrature, depth read and quality tier. Null restores the page's own settings.
   * A quality change rebuilds the water mesh, so the caller settles before it measures.
   */
  setWaterVariant?(variant: IWaterLodSpikeSphereVariant | null): void;
  /** What draws now: a body counts once its pipeline is compiled and it is visible; the atmosphere counts while enabled. */
  drawn(): IWaterLodSpikeSphereLayers;
  counts(): { readonly drawCalls: number; readonly triangles: number };
  beginFrameSampling(): void;
  /** Frame intervals (ms) since `beginFrameSampling`. */
  endFrameSampling(): readonly number[];
  /** CPU time (ms) of each frame since `beginFrameSampling`; call after `endFrameSampling`. */
  takeCpuFrameMs(): readonly number[];
  /** GPU frame time (ms, one-second average from timestamp queries), or null when unsupported. */
  gpuFrameMs(): number | null;
  waitFrames(count: number, context: TestContext): Promise<void>;
  /**
   * Holds the wave clock still at this time (seconds) so stills of different settings show the same waves; null hands the clock back
   * to the page's own (running or paused, as the page had it).
   */
  holdWaveTime?(seconds: number | null): void;
  /** A small picture of the canvas for the results page; never taken inside a timing window. */
  thumbnail?(): Promise<Blob | undefined>;
  /** The largest picture of the canvas that fits the receiver's per-image limit (the stills suite's evidence); never taken inside a timing window. */
  still?(): Promise<Blob | undefined>;
  environment(): Readonly<Record<string, TestSetting>>;
}

/** The poses of the cost suite: orbit, 20 km up, the coast at 50 m, and the 2 m eye. */
const POSES: readonly (readonly [SpherePoseId, string])[] = [
  ['orbit', 'Orbit, the whole globe'],
  ['mid-20km', '20 km up, looking north'],
  ['coast-300m', 'Coast, 50 m up'],
  ['eye-2m', '2 m eye at the coast'],
];

/**
 * Suite `water-lod-spike-sphere-cost` v1 (Plan 080, water on a planet, stage A): what the water costs on the planet next to the
 * terrain and the atmosphere, and what the whole stack costs. Five layer sets (arms) at each of four poses:
 *
 * - A: land only (the terrain alone)
 * - B: land and atmosphere
 * - C: land and water
 * - D: land, water and atmosphere (the stack the game ships)
 * - E: water only
 *
 * Each arm's mean GPU frame is taken over three one-second windows after 1.5 s of warm-up, in two rounds, the second in the
 * opposite order, so a slow drift of the machine cancels in the mean. Pixel ratio 1; the drawing buffer size is in the environment.
 *
 * Gates (written before the first run): the water's marginal GPU cost, C minus A, is at most 0.5 ms (plan 080's numeric gate,
 * defined on an RTX 3080 at 2560 x 1440 in a visible browser, so a run elsewhere is evidence only); the full stack D is at most
 * 8.3 ms (120 Hz; this budget is the spike's proposal, not a plan figure); every layer draws; the GPU time is measured and the
 * arms the water gate subtracts are long enough to read a difference. Reported, not gated: every arm's GPU and CPU frame, the
 * longest frame after each switch, the triangles, and the marginal cost of the atmosphere and of the water on each stack.
 */
const WATER_LOD_SPIKE_SPHERE_COST_V1: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-cost',
  version: 1,
  title: 'Water on a planet, stage A: what the water, the atmosphere and the terrain cost together',
  purpose: 'performance',
  scenarios: POSES.map(([pose, label]) => ({
    id: pose,
    label,
    settings: { pose, measure: 'cost' as const },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/**
 * Suite `water-lod-spike-sphere-split` v1 (Plan 080): what the water's own cost is made of. The cost suite v1 found the water at
 * 1.6 to 3.3 ms against the 0.5 ms gate; this one takes the water apart on the land (atmosphere off), at the same four poses:
 *
 * - land: the baseline, no water
 * - full: the water as the page ships it (ultra quality, 3 x 3 quadrature, shore, foam and depth colour)
 * - no quadrature: one sample at the mean slope instead of nine
 * - no depth read: no shore weight, foam or depth colour (no land read per pixel)
 * - plain shading: both of the above off
 * - low quality: the `low` tier (larger cells, fewer leaves, earlier wave fade) with the full shading
 * - cheapest: low quality and plain shading
 *
 * If the plain-shading arm is near the full one, the fragment stage is not the cost; if the low-quality arm is, the triangle count
 * and the vertex stage are not. Each arm is read like the cost suite's (three one-second windows after a warm-up, two rounds, the
 * second in the opposite order). Nothing is gated; every arm's GPU and CPU frame, triangles and the cost over the land are reported.
 * Checks only that the water draws in each arm and that GPU time is measured.
 */
const WATER_LOD_SPIKE_SPHERE_SPLIT_V1: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-split',
  version: 1,
  title: 'Water on a planet: what the water\'s cost is made of (quadrature, depth read, mesh density)',
  purpose: 'performance',
  scenarios: POSES.map(([pose, label]) => ({
    id: pose,
    label,
    settings: { pose, measure: 'split' as const },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/**
 * Suite `water-lod-spike-sphere-density` v1 (Plan 080): what the water costs on its own, with no land and no atmosphere. The split
 * suite v1 showed the pixel shading is not the main cost at any pose, and the cost is large from orbit (where land covers little),
 * so the mesh and the vertex stage are the suspects. This one varies them one at a time at the four poses, water alone:
 *
 * - nothing: an empty frame, the baseline
 * - ultra: the tier the page ships (4 px cells, 4096 leaves)
 * - ultra, no waves: the ultra mesh with every wave off in both stages (a flat sphere at ultra density)
 * - ultra, plain: ultra with the quadrature off
 * - cap 1024 / cap 256: ultra's 4 px cells with fewer leaves
 * - cells 10 px: ultra's leaf cap with 10 px cells (cell-limited rather than cap-limited)
 * - bias 4: ultra's mesh with the low tier's wave filter bias (waves fade earlier)
 * - high, low: the tiers
 *
 * If the no-waves arm is near ultra, the triangle count is the cost; if it is near nothing, the wave work is. Each arm is read
 * like the cost suite's. Nothing is gated; GPU and CPU frame, triangles and the cost over the empty frame are reported.
 */
const WATER_LOD_SPIKE_SPHERE_DENSITY_V1: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-density',
  version: 1,
  title: 'Water on a planet, alone: mesh density against wave work',
  purpose: 'performance',
  scenarios: POSES.map(([pose, label]) => ({
    id: pose,
    label,
    settings: { pose, measure: 'density' as const },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/**
 * Suite `water-lod-spike-sphere-horizon` v1 (Plan 080): what leaving out the leaves behind the planet's horizon saves, and what a
 * smaller leaf cap saves on top, water alone. The density run found a leaf is 512 triangles, the cap counts leaves behind the
 * planet too, and nothing culled them. Arms: the shipped ultra without the cull (the density run's arm), ultra with it, then
 * the cull with leaf caps 1024, 512, 256 and 64 (64 is the floor: almost no mesh left), the high and low tiers, and ultra with no
 * waves. Each arm is read like the density suite's. Nothing is gated; the triangles and the cost over an empty frame are reported.
 */
const WATER_LOD_SPIKE_SPHERE_HORIZON_V1: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-horizon',
  version: 1,
  title: 'Water on a planet, alone: leaves behind the horizon and the leaf cap',
  purpose: 'performance',
  scenarios: POSES.map(([pose, label]) => ({
    id: pose,
    label,
    settings: { pose, measure: 'horizon' as const },
    durationMs: 1000,
    warmupMs: 500,
  })),
};

/** The water's leaf caps the stills suite compares: the old ultra, the new ultra, and the next step down. */
export const SPHERE_STILL_LEAF_CAPS: readonly number[] = [4096, 2048, 1024];
/** The wave clock of every still (seconds), so the same pose shows the same waves at every cap. */
export const SPHERE_STILL_WAVE_TIME_S = 20;
const STILL_COUNT_SETTLE_MS = 3000;

/**
 * Suite `water-lod-spike-sphere-stills` v1 (Plan 080): does the water look the same at 2048 leaves as at 4096? One still per pose
 * and leaf cap (4096, 2048, 1024) of the whole stack (land, water and atmosphere, the horizon cull on), with the wave clock held at one
 * time so the only difference between two stills of a pose is the water's mesh. The land stays at 4096 leaves. The largest picture
 * that fits the receiver's 64 KB limit is kept per case. Each case also reports the GPU frame of the whole stack and the triangles, so
 * the saving at each cap is read off the same run.
 *
 * Checks: every layer draws, and the triangle count is steady over the measuring window (the mesh has settled). The look is for
 * a reviewer: `requiresVisualReview` is set and nothing is accepted automatically.
 */
const WATER_LOD_SPIKE_SPHERE_STILLS_V1: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-stills',
  version: 1,
  title: 'Water on a planet: stills of the whole stack at 4096, 2048 and 1024 water leaves',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: POSES.flatMap(([pose, label]) =>
    SPHERE_STILL_LEAF_CAPS.map((leafCap) => ({
      id: `${pose}-${leafCap}`,
      label: `${label}, ${leafCap} leaves`,
      settings: { pose, measure: 'stills' as const, leafCap },
      durationMs: 1000,
      warmupMs: 500,
    })),
  ),
};

/** The metric the water-alone suite budgets and compares. */
export const SPHERE_WATER_ALONE_METRIC = 'GPU frame, water alone';
/** The most GPU time (median, ms) arm A may take at the eye and the coast, and at 20 km (planet-water answer, section 6). */
export const SPHERE_WATER_ALONE_MAX_NEAR_MS = 1.5;
export const SPHERE_WATER_ALONE_MAX_20KM_MS = 1.0;

/**
 * The water-alone suite's settings. All four keep the shipped ultra shading and 4 px cells with the horizon cull on, and differ in
 * the one thing named. A: 256 patches (leaves), full waves. B: A with every wave off. C: A at half the drawn pixels. D: A at 1,024 patches.
 */
export const SPHERE_WATER_ALONE_ARMS: Readonly<Record<SphereWaterAloneArmId, IWaterLodSpikeSphereVariant>> = {
  A: { quadrature: true, depthRead: true, quality: 'ultra', horizon: true, mesh: { cellPixels: 4, leafCap: 256 } },
  B: { quadrature: true, depthRead: true, quality: 'ultra', horizon: true, mesh: { cellPixels: 4, leafCap: 256 }, waves: false },
  C: { quadrature: true, depthRead: true, quality: 'ultra', horizon: true, mesh: { cellPixels: 4, leafCap: 256 }, pixelScale: 0.5 },
  D: { quadrature: true, depthRead: true, quality: 'ultra', horizon: true, mesh: { cellPixels: 4, leafCap: 1024 } },
};

const WATER_ALONE_POSES: readonly (readonly [SpherePoseId, string, number | undefined])[] = [
  ['eye-2m', '2 m eye', SPHERE_WATER_ALONE_MAX_NEAR_MS],
  ['coast-300m', 'Coast, 50 m', SPHERE_WATER_ALONE_MAX_NEAR_MS],
  ['mid-20km', '20 km', SPHERE_WATER_ALONE_MAX_20KM_MS],
  ['orbit', 'Orbit', undefined],
];

/** Each partner is compared with A in its own group: B waves off, C half the pixels, D 1,024 patches. */
const WATER_ALONE_PARTNERS: readonly (readonly [key: string, arm: Exclude<SphereWaterAloneArmId, 'A'>, label: string])[] = [
  ['waves', 'B', 'waves off'],
  ['pixels', 'C', 'half the pixels'],
  ['patches', 'D', '1,024 patches'],
];

/**
 * Suite `water-lod-spike-sphere-density` v2 (Plan 080; the architect's first test for the water, planet-water answer, "The first
 * test to build"): is the water's 1-2 ms floor pixels or vertices? Water alone against an empty frame (no land, no atmosphere), at
 * four views (2 m eye, 50 m coast, 20 km, orbit) and four settings:
 *
 * - A: 256 patches (the leaf cap), full waves, the shipped ultra shading, 4 px cells, the horizon cull on
 * - B: A with every wave off (A/B partner of A)
 * - C: A at half the drawn pixels, the renderer's pixel ratio times the square root of a half (A/B partner of A)
 * - D: 1,024 patches, full waves (A/B partner of A)
 *
 * B, C and D are each an A/B group per view (A, partner, A, partner, ...), so run it with 3 repetitions for three rounds per arm.
 * The metric is `GPU frame, water alone`: five one-second timestamp-query averages after a warm-up. Triangles, the drawing buffer
 * pixels and the CPU frame are reported. Run it headed and quiet on the NVIDIA GPU (`expectedGpuVendor`); an A/B group whose
 * rounds spread more than 15% is rejected, which is the "spread within 15%" condition.
 *
 * Budget (runner, on arm A only): GPU median at most 1.5 ms at eye and coast and at most 1.0 ms at 20 km. Orbit has none. The
 * figure is the arm's own frame, water over an empty frame; the empty frame's cost is not subtracted. The runner cannot express
 * "headed and clean": read the profile and the machine warnings in `npm run test:summary`.
 *
 * What a fail means:
 * - C is about half of A (the A/B line for the pixels group shows about -50%): the cost is pixels. Work on the shading loop.
 * - B is close to A and C does not help: the cost is fixed per vertex. Use fewer, larger patches, or fewer waves in the geometry.
 * - D passes too (read D's frame against the same 1.5 / 1.0 ms): raise the default patch cap to 1,024.
 *
 * Settings the page gained: `pixelScale` on the held water variant (the page lowers the renderer's pixel ratio; the wave footprint
 * filter reads the smaller buffer, and the terrain selector sees a smaller viewport, so C's patch count can move: the triangle
 * metric shows it). `waves` and `mesh.leafCap` existed. The engine is unchanged.
 */
const WATER_LOD_SPIKE_SPHERE_DENSITY_V2: TestSuite<WaterLodSpikeSphereTestSettings> = {
  id: 'water-lod-spike-sphere-density',
  version: 2,
  title: 'Water on a planet, alone: pixels against vertices (256 patches, waves off, half pixels, 1,024 patches)',
  purpose: 'performance',
  expectedGpuVendor: 'nvidia',
  ablation: { feature: 'waves off (B), half the pixels (C) or 1,024 patches (D), each against A', metrics: [SPHERE_WATER_ALONE_METRIC] },
  scenarios: WATER_ALONE_POSES.flatMap(([pose, label, budgetMs]) =>
    WATER_ALONE_PARTNERS.flatMap(([key, partner, partnerLabel]) =>
      (['A', partner] as const).map((arm): TestScenario<WaterLodSpikeSphereTestSettings> => ({
        id: `${pose}-${arm}-${key}`,
        label: `${label}: ${arm}, ${arm === 'A' ? `reference (vs ${partnerLabel})` : partnerLabel}`,
        settings: { pose, measure: 'water-alone', arm },
        durationMs: 1000,
        warmupMs: 500,
        ablation: { group: `${pose}-${key}`, arm: arm === 'A' ? 'A' : 'B' },
        ...(arm === 'A' && budgetMs !== undefined ? { budgets: { [SPHERE_WATER_ALONE_METRIC]: { median: budgetMs } } } : {}),
      })),
    ),
  ),
};

/** The suites of the sphere water page, oldest first. */
export const WATER_LOD_SPIKE_SPHERE_TEST_HISTORY: readonly TestSuite<WaterLodSpikeSphereTestSettings>[] = [
  WATER_LOD_SPIKE_SPHERE_COST_V1,
  WATER_LOD_SPIKE_SPHERE_SPLIT_V1,
  WATER_LOD_SPIKE_SPHERE_DENSITY_V1,
  WATER_LOD_SPIKE_SPHERE_HORIZON_V1,
  WATER_LOD_SPIKE_SPHERE_STILLS_V1,
  WATER_LOD_SPIKE_SPHERE_DENSITY_V2,
];

/** One arm of the split suite: land only, or land and water at a variant. */
export interface ISphereSplitArm {
  readonly id: string;
  /** Null: the land alone. */
  readonly variant: IWaterLodSpikeSphereVariant | null;
}

const FULL_WATER: IWaterLodSpikeSphereVariant = { quadrature: true, depthRead: true, quality: 'ultra' };

export const SPHERE_SPLIT_ARMS: readonly ISphereSplitArm[] = [
  { id: 'land', variant: null },
  { id: 'full', variant: FULL_WATER },
  { id: 'no quadrature', variant: { ...FULL_WATER, quadrature: false } },
  { id: 'no depth read', variant: { ...FULL_WATER, depthRead: false } },
  { id: 'plain shading', variant: { ...FULL_WATER, quadrature: false, depthRead: false } },
  { id: 'low quality', variant: { ...FULL_WATER, quality: 'low' } },
  { id: 'cheapest', variant: { quadrature: false, depthRead: false, quality: 'low' } },
];

/** The order the split arms are measured in: all, then all again in the opposite order. */
export function sphereSplitOrder(arms: readonly ISphereSplitArm[] = SPHERE_SPLIT_ARMS): readonly ISphereSplitArm[] {
  return [...arms, ...[...arms].reverse()];
}

const ULTRA_WATER: IWaterLodSpikeSphereVariant = { quadrature: true, depthRead: true, quality: 'ultra' };

/** The density suite's arms; the first (no water) is the empty-frame baseline. The land is off in all of them. */
export const SPHERE_DENSITY_ARMS: readonly ISphereSplitArm[] = [
  { id: 'nothing', variant: null },
  { id: 'ultra', variant: ULTRA_WATER },
  { id: 'ultra, no waves', variant: { ...ULTRA_WATER, quadrature: false, waves: false } },
  { id: 'ultra, plain', variant: { ...ULTRA_WATER, quadrature: false } },
  { id: 'cap 1024', variant: { ...ULTRA_WATER, mesh: { cellPixels: 4, leafCap: 1024 } } },
  { id: 'cap 256', variant: { ...ULTRA_WATER, mesh: { cellPixels: 4, leafCap: 256 } } },
  { id: 'cells 10 px', variant: { ...ULTRA_WATER, mesh: { cellPixels: 10, leafCap: 4096 } } },
  { id: 'bias 4', variant: { ...ULTRA_WATER, lodBias: 4 } },
  { id: 'high', variant: { ...ULTRA_WATER, quality: 'high' } },
  { id: 'low', variant: { ...ULTRA_WATER, quality: 'low' } },
];

const HORIZON_ULTRA: IWaterLodSpikeSphereVariant = { ...ULTRA_WATER, horizon: true };
const capped = (leafCap: number): IWaterLodSpikeSphereVariant => ({ ...HORIZON_ULTRA, mesh: { cellPixels: 4, leafCap } });

/** The horizon suite's arms; the first (no water) is the empty-frame baseline. The land is off in all of them. */
export const SPHERE_HORIZON_ARMS: readonly ISphereSplitArm[] = [
  { id: 'nothing', variant: null },
  { id: 'ultra', variant: ULTRA_WATER },
  { id: 'ultra, horizon', variant: HORIZON_ULTRA },
  { id: 'cap 1024, horizon', variant: capped(1024) },
  { id: 'cap 512, horizon', variant: capped(512) },
  { id: 'cap 256, horizon', variant: capped(256) },
  { id: 'cap 64, horizon', variant: capped(64) },
  { id: 'high, horizon', variant: { ...HORIZON_ULTRA, quality: 'high' } },
  { id: 'low, horizon', variant: { ...HORIZON_ULTRA, quality: 'low' } },
  { id: 'ultra, no waves, horizon', variant: { ...HORIZON_ULTRA, quadrature: false, waves: false } },
];

/** The plan 080 water gate: the water's marginal GPU cost on the terrain, milliseconds. */
export const SPHERE_WATER_MAX_MARGINAL_MS = 0.5;
/** The proposed budget for the whole stack, milliseconds (120 Hz). */
export const SPHERE_STACK_MAX_MS = 8.3;
/** An arm must be at least this long for a difference to be read (five steps of the 0.1 ms timestamp resolution). */
export const SPHERE_COST_MIN_FRAME_MS = 0.5;

/** One arm of the cost suite. */
export interface ISphereCostArm extends IWaterLodSpikeSphereLayers {
  readonly id: string;
}

export const SPHERE_COST_ARMS: readonly ISphereCostArm[] = [
  { id: 'land', land: true, water: false, atmosphere: false },
  { id: 'land + atmosphere', land: true, water: false, atmosphere: true },
  { id: 'land + water', land: true, water: true, atmosphere: false },
  { id: 'land + water + atmosphere', land: true, water: true, atmosphere: true },
  { id: 'water', land: false, water: true, atmosphere: false },
];

const GPU_WARMUP_MS = 1500;
const GPU_SAMPLES = 3;
const SETTLE_FRAMES = 30;
const WATER_ALONE_GPU_SAMPLES = 5;
const DRAWN_TIMEOUT_MS = 60_000;

const mean = (values: readonly number[]): number => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN);

const drawsAll = (drawn: IWaterLodSpikeSphereLayers, arm: IWaterLodSpikeSphereLayers): boolean =>
  drawn.land === arm.land && drawn.water === arm.water && drawn.atmosphere === arm.atmosphere;

/** The order the arms are measured in: all five, then all five again in the opposite order. */
export function sphereCostOrder(arms: readonly ISphereCostArm[] = SPHERE_COST_ARMS): readonly ISphereCostArm[] {
  return [...arms, ...[...arms].reverse()];
}

async function gpuMeanMs(host: WaterLodSpikeSphereTestHost, context: TestContext): Promise<number> {
  await context.wait(GPU_WARMUP_MS);
  const samples: number[] = [];
  for (let n = 0; n < GPU_SAMPLES; n++) {
    await context.wait(1000);
    const sample = host.gpuFrameMs();
    if (sample !== null) samples.push(sample);
  }
  return mean(samples);
}

async function measureCost(host: WaterLodSpikeSphereTestHost, context: TestContext): Promise<TestObservation> {
  await host.waitFrames(SETTLE_FRAMES, context);
  const gpuMs = new Map<ISphereCostArm, number[]>(SPHERE_COST_ARMS.map((arm) => [arm, []]));
  const cpuMs = new Map<ISphereCostArm, number[]>(SPHERE_COST_ARMS.map((arm) => [arm, []]));
  const hitchMs = new Map<ISphereCostArm, number[]>(SPHERE_COST_ARMS.map((arm) => [arm, []]));
  const triangles = new Map<ISphereCostArm, number>();
  const drawnAll = new Map<ISphereCostArm, boolean>(SPHERE_COST_ARMS.map((arm) => [arm, true]));
  for (const arm of sphereCostOrder()) {
    host.beginFrameSampling();
    const flipped = performance.now();
    host.setLayers(arm);
    await host.waitFrames(2, context);
    while (!drawsAll(host.drawn(), arm) && performance.now() - flipped < DRAWN_TIMEOUT_MS) await host.waitFrames(1, context);
    if (!drawsAll(host.drawn(), arm)) drawnAll.set(arm, false);
    await host.waitFrames(SETTLE_FRAMES, context);
    hitchMs.get(arm)?.push(Math.max(0, ...host.endFrameSampling()));
    host.takeCpuFrameMs();
    host.beginFrameSampling();
    gpuMs.get(arm)?.push(await gpuMeanMs(host, context));
    host.endFrameSampling();
    cpuMs.get(arm)?.push(mean(host.takeCpuFrameMs()));
    triangles.set(arm, host.counts().triangles);
  }
  host.setLayers(null);
  const [land, landAtmosphere, landWater, stack, waterOnly] = SPHERE_COST_ARMS;
  const gpu = (arm: ISphereCostArm): number => mean(gpuMs.get(arm) ?? []);
  const waterMarginal = gpu(landWater) - gpu(land);
  const waterOnStack = gpu(stack) - gpu(landAtmosphere);
  const atmosphereOnLand = gpu(landAtmosphere) - gpu(land);
  const atmosphereOnWater = gpu(stack) - gpu(landWater);
  const shortest = Math.min(gpu(land), gpu(landWater));
  const draws = host.counts();
  const undrawn = SPHERE_COST_ARMS.filter((arm) => drawnAll.get(arm) !== true).map((arm) => arm.id);
  return {
    metrics: [
      ...SPHERE_COST_ARMS.map((arm) => ({ name: `GPU frame, ${arm.id}`, unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages, two rounds', samples: gpuMs.get(arm) ?? [] })),
      ...SPHERE_COST_ARMS.map((arm) => ({ name: `CPU frame, ${arm.id}`, unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render), mean over the GPU window', samples: cpuMs.get(arm) ?? [] })),
      ...SPHERE_COST_ARMS.map((arm) => ({ name: `longest frame after the switch, ${arm.id}`, unit: 'ms', source: 'engine.tick$ intervals from the switch to the settled frame', samples: hitchMs.get(arm) ?? [] })),
      ...SPHERE_COST_ARMS.map((arm) => ({ name: `triangles, ${arm.id}`, unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles.get(arm) ?? Number.NaN] })),
      { name: 'cost of the water on the land (land + water minus land)', unit: 'ms', source: 'means of two arms', samples: [waterMarginal] },
      { name: 'cost of the water on land and atmosphere', unit: 'ms', source: 'means of two arms', samples: [waterOnStack] },
      { name: 'cost of the atmosphere on the land', unit: 'ms', source: 'means of two arms', samples: [atmosphereOnLand] },
      { name: 'cost of the atmosphere on land and water', unit: 'ms', source: 'means of two arms', samples: [atmosphereOnWater] },
      { name: 'GPU frame of the water body alone over the stack', unit: 'ratio', source: 'means of two arms', samples: [gpu(waterOnly) / gpu(stack)] },
    ],
    checks: [
      { name: 'every layer draws in every arm', passed: undrawn.length === 0, detail: undrawn.length === 0 ? `draw calls ${draws.drawCalls}` : `not drawn in: ${undrawn.join(', ')}` },
      { name: 'GPU time measured in every arm', passed: SPHERE_COST_ARMS.every((arm) => Number.isFinite(gpu(arm))), detail: SPHERE_COST_ARMS.map((arm) => `${gpu(arm).toFixed(2)} ms`).join(', ') },
      { name: `the land and the land + water arms are at least ${SPHERE_COST_MIN_FRAME_MS} ms, so their difference can be read`, passed: shortest >= SPHERE_COST_MIN_FRAME_MS, detail: `shortest ${shortest.toFixed(3)} ms` },
      { name: `the water costs at most ${SPHERE_WATER_MAX_MARGINAL_MS} ms of GPU time on the land (plan 080 gate; defined on an RTX 3080 at 2560 x 1440 in a visible browser)`, passed: waterMarginal <= SPHERE_WATER_MAX_MARGINAL_MS, detail: `${waterMarginal.toFixed(3)} ms` },
      { name: `the whole stack (land, water, atmosphere) takes at most ${SPHERE_STACK_MAX_MS} ms of GPU time (proposed budget, 120 Hz)`, passed: gpu(stack) <= SPHERE_STACK_MAX_MS, detail: `${gpu(stack).toFixed(3)} ms` },
    ],
  };
}

/**
 * Measures a list of water variants whose first arm has no water (the baseline), each twice (the second pass reversed). `land` is
 * whether the land draws in every arm; the baseline is then the land alone, else an empty frame.
 */
async function measureVariants(
  host: WaterLodSpikeSphereTestHost,
  context: TestContext,
  arms: readonly ISphereSplitArm[],
  land: boolean,
): Promise<TestObservation> {
  const setVariant = host.setWaterVariant?.bind(host);
  await host.waitFrames(SETTLE_FRAMES, context);
  const gpuMs = new Map<ISphereSplitArm, number[]>(arms.map((arm) => [arm, []]));
  const cpuMs = new Map<ISphereSplitArm, number[]>(arms.map((arm) => [arm, []]));
  const triangles = new Map<ISphereSplitArm, number>();
  const drawnAll = new Map<ISphereSplitArm, boolean>(arms.map((arm) => [arm, true]));
  const baseline = land ? 'the land' : 'an empty frame';
  for (const arm of sphereSplitOrder(arms)) {
    const layers: IWaterLodSpikeSphereLayers = { land, water: arm.variant !== null, atmosphere: false };
    host.setLayers(layers);
    setVariant?.(arm.variant);
    const flipped = performance.now();
    await host.waitFrames(2, context);
    while (!drawsAll(host.drawn(), layers) && performance.now() - flipped < DRAWN_TIMEOUT_MS) await host.waitFrames(1, context);
    if (!drawsAll(host.drawn(), layers)) drawnAll.set(arm, false);
    await host.waitFrames(SETTLE_FRAMES, context);
    host.beginFrameSampling();
    gpuMs.get(arm)?.push(await gpuMeanMs(host, context));
    host.endFrameSampling();
    cpuMs.get(arm)?.push(mean(host.takeCpuFrameMs()));
    triangles.set(arm, host.counts().triangles);
  }
  setVariant?.(null);
  host.setLayers(null);
  const gpu = (arm: ISphereSplitArm): number => mean(gpuMs.get(arm) ?? []);
  const [base, ...waterArms] = arms;
  const undrawn = arms.filter((arm) => drawnAll.get(arm) !== true).map((arm) => arm.id);
  return {
    metrics: [
      ...arms.map((arm) => ({ name: `GPU frame, ${arm.id}`, unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages, two rounds', samples: gpuMs.get(arm) ?? [] })),
      ...arms.map((arm) => ({ name: `CPU frame, ${arm.id}`, unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render), mean over the GPU window', samples: cpuMs.get(arm) ?? [] })),
      ...arms.map((arm) => ({ name: `triangles, ${arm.id}`, unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles.get(arm) ?? Number.NaN] })),
      ...waterArms.map((arm) => ({ name: `cost over ${baseline}, ${arm.id}`, unit: 'ms', source: 'means of two arms', samples: [gpu(arm) - gpu(base)] })),
    ],
    checks: [
      { name: 'the water draws in every water arm and the land in all', passed: undrawn.length === 0, detail: undrawn.length === 0 ? 'all drawn' : `not drawn in: ${undrawn.join(', ')}` },
      { name: 'GPU time measured in every arm', passed: arms.every((arm) => Number.isFinite(gpu(arm))), detail: arms.map((arm) => `${gpu(arm).toFixed(2)} ms`).join(', ') },
      { name: 'the host can hold a water variant', passed: setVariant !== undefined, detail: setVariant ? 'yes' : 'the page has no setWaterVariant' },
    ],
  };
}

/** One-second GPU averages after a warm-up; samples the timestamp query could not give are left out. */
async function gpuSamplesMs(host: WaterLodSpikeSphereTestHost, context: TestContext, count: number): Promise<number[]> {
  await context.wait(GPU_WARMUP_MS);
  const samples: number[] = [];
  for (let n = 0; n < count; n++) {
    await context.wait(1000);
    const sample = host.gpuFrameMs();
    if (sample !== null) samples.push(sample);
  }
  return samples;
}

/** Water alone, held at the case's setting of the water-alone suite; the A/B analysis compares the rounds. */
async function measureWaterAlone(host: WaterLodSpikeSphereTestHost, context: TestContext, armId: SphereWaterAloneArmId): Promise<TestObservation> {
  const setVariant = host.setWaterVariant?.bind(host);
  const layers: IWaterLodSpikeSphereLayers = { land: false, water: true, atmosphere: false };
  await host.waitFrames(SETTLE_FRAMES, context);
  const pixelsBefore = host.drawingBufferPixels?.() ?? Number.NaN;
  host.setLayers(layers);
  setVariant?.(SPHERE_WATER_ALONE_ARMS[armId]);
  const flipped = performance.now();
  await host.waitFrames(2, context);
  while (!drawsAll(host.drawn(), layers) && performance.now() - flipped < DRAWN_TIMEOUT_MS) await host.waitFrames(1, context);
  const drawnAll = drawsAll(host.drawn(), layers);
  await host.waitFrames(SETTLE_FRAMES, context);
  host.beginFrameSampling();
  const gpu = await gpuSamplesMs(host, context, WATER_ALONE_GPU_SAMPLES);
  host.endFrameSampling();
  const cpuMs = mean(host.takeCpuFrameMs());
  const { triangles, drawCalls } = host.counts();
  const pixels = host.drawingBufferPixels?.() ?? Number.NaN;
  const pixelRatio = pixels / pixelsBefore;
  const pixelsOk = armId === 'C' ? pixelRatio > 0.45 && pixelRatio < 0.55 : Number.isNaN(pixelRatio) || Math.abs(pixelRatio - 1) < 0.01;
  return {
    metrics: [
      { name: SPHERE_WATER_ALONE_METRIC, unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages after a warm-up', samples: gpu },
      { name: 'CPU frame, water alone', unit: 'ms', source: 'fpsController.cpuFrameTime (tick and render), mean over the GPU window', samples: [cpuMs] },
      { name: 'triangles, water alone', unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles] },
      { name: 'drawing buffer pixels', unit: 'pixels', source: 'renderer.domElement width times height', samples: [pixels] },
    ],
    checks: [
      { name: 'the water draws and nothing else does', passed: drawnAll, detail: drawnAll ? `draw calls ${drawCalls}` : 'the water did not draw in time' },
      { name: 'GPU time measured', passed: gpu.length === WATER_ALONE_GPU_SAMPLES, detail: gpu.map((value) => value.toFixed(2)).join(', ') || 'no timestamp samples' },
      { name: armId === 'C' ? 'half the pixels are drawn (0.45 to 0.55 of the page\'s own)' : 'the full pixel count is drawn', passed: pixelsOk, detail: `${pixels} of ${pixelsBefore} pixels` },
      { name: 'the host can hold a water variant', passed: setVariant !== undefined, detail: setVariant ? 'yes' : 'the page has no setWaterVariant' },
    ],
  };
}

const measureSplit =(host: WaterLodSpikeSphereTestHost, context: TestContext): Promise<TestObservation> =>
  measureVariants(host, context, SPHERE_SPLIT_ARMS, true);

const measureDensity = (host: WaterLodSpikeSphereTestHost, context: TestContext): Promise<TestObservation> =>
  measureVariants(host, context, SPHERE_DENSITY_ARMS, false);

const measureHorizon = (host: WaterLodSpikeSphereTestHost, context: TestContext): Promise<TestObservation> =>
  measureVariants(host, context, SPHERE_HORIZON_ARMS, false);

/** The water as the stills suite holds it: the shipped ultra shading with the horizon cull and the case's leaf cap, 4 px cells. */
export function sphereStillVariant(leafCap: number): IWaterLodSpikeSphereVariant {
  return { ...ULTRA_WATER, horizon: true, mesh: { cellPixels: 4, leafCap } };
}

/**
 * Puts the whole stack up at one leaf cap and measures it, leaving it up: the case's picture is taken after this returns, and
 * `restore` hands the page its own settings back.
 */
async function measureStills(host: WaterLodSpikeSphereTestHost, context: TestContext, leafCap: number): Promise<TestObservation> {
  const layers: IWaterLodSpikeSphereLayers = { land: true, water: true, atmosphere: true };
  const setVariant = host.setWaterVariant?.bind(host);
  await host.waitFrames(SETTLE_FRAMES, context);
  host.holdWaveTime?.(SPHERE_STILL_WAVE_TIME_S);
  host.setLayers(layers);
  setVariant?.(sphereStillVariant(leafCap));
  const flipped = performance.now();
  await host.waitFrames(2, context);
  while (!drawsAll(host.drawn(), layers) && performance.now() - flipped < DRAWN_TIMEOUT_MS) await host.waitFrames(1, context);
  const drawnAll = drawsAll(host.drawn(), layers);
  await host.waitFrames(SETTLE_FRAMES, context);
  // The page refreshes its triangle count twice a second, so wait past a refresh before the first read (the mesh also rebuilds for a moment after a cap change).
  await context.wait(STILL_COUNT_SETTLE_MS);
  const before = host.counts();
  host.beginFrameSampling();
  const gpuMs = await gpuMeanMs(host, context);
  host.endFrameSampling();
  host.takeCpuFrameMs();
  const after = host.counts();
  return {
    metrics: [
      { name: 'GPU frame, land, water and atmosphere', unit: 'ms', source: 'WebGPU timestamp queries, 1 s averages after a warm-up', samples: [gpuMs] },
      { name: 'triangles', unit: 'triangles', source: 'renderer.info.render.triangles', samples: [after.triangles] },
      { name: 'draw calls', unit: 'calls', source: 'renderer.info.render', samples: [after.drawCalls] },
      { name: 'water leaf cap', unit: 'leaves', source: 'the case setting', samples: [leafCap] },
    ],
    checks: [
      { name: 'the land, the water and the atmosphere all draw', passed: drawnAll, detail: drawnAll ? `draw calls ${after.drawCalls}` : 'a layer did not draw in time' },
      { name: 'the mesh has settled: the triangle count did not change over the window', passed: before.triangles === after.triangles, detail: `${before.triangles} before, ${after.triangles} after` },
      { name: 'GPU time measured', passed: Number.isFinite(gpuMs), detail: `${gpuMs.toFixed(2)} ms` },
      { name: 'the host can hold a water variant and the wave clock', passed: setVariant !== undefined && host.holdWaveTime !== undefined, detail: setVariant && host.holdWaveTime ? 'yes' : 'the page lacks setWaterVariant or holdWaveTime' },
    ],
  };
}

/**
 * Testing adapter for the sphere water page: holds the pose and the layer set the case asks for, waits for the page to draw, and
 * measures the cost arms (see {@link WATER_LOD_SPIKE_SPHERE_TEST_HISTORY}). Nothing here switches `<scene>`'s wireframe.
 */
export function createWaterLodSpikeSphereTestAdapter(host: WaterLodSpikeSphereTestHost): TestRunAdapter<WaterLodSpikeSphereTestSettings, boolean> {
  return simpleAdapter<WaterLodSpikeSphereTestSettings, boolean>({
    windowModes: false,
    capture: () => true,
    apply: (scenario) => host.setPose(scenario.settings.pose),
    ...(host.thumbnail || host.still
      ? {
          thumbnail: async (scenario: TestScenario<WaterLodSpikeSphereTestSettings>, context: TestContext) => {
            if (context.repetition > 1) return undefined;
            const take = scenario.settings.measure === 'stills' && host.still ? host.still : host.thumbnail;
            const image = await take?.call(host);
            return image ? [image] : undefined;
          },
        }
      : {}),
    restore: () => {
      host.setPose(null);
      host.setWaterVariant?.(null);
      host.holdWaveTime?.(null);
      host.setLayers(null);
    },
    ready: async (context) => {
      while (!host.ready()) await context.wait(100);
    },
    environment: () => host.environment(),
    measure: async (scenario, context): Promise<TestObservation> => {
      switch (scenario.settings.measure) {
        case 'split': return measureSplit(host, context);
        case 'density': return measureDensity(host, context);
        case 'horizon': return measureHorizon(host, context);
        case 'water-alone': return measureWaterAlone(host, context, scenario.settings.arm ?? 'A');
        case 'stills': return measureStills(host, context, scenario.settings.leafCap ?? SPHERE_STILL_LEAF_CAPS[1]);
        default: return measureCost(host, context);
      }
    },
  });
}
