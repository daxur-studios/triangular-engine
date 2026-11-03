import { simpleAdapter, type TestContext, type TestObservation, type TestRunAdapter, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import type { SpherePoseId } from './core/water-lod-spike-sphere-poses';

/** What a sphere water case sets and measures. */
export interface WaterLodSpikeSphereTestSettings {
  readonly pose: SpherePoseId;
  readonly measure: 'cost';
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
  /** Holds the camera at the pose; null hands it back to the page's own. */
  setPose(id: SpherePoseId | null): void;
  /**
   * Puts the layers on or off: the land and the water bodies are added or removed (their meshes rebuild and compile when they
   * come back), the atmosphere is `enabled` or not (no recompile). Null restores the page's own settings.
   */
  setLayers(layers: IWaterLodSpikeSphereLayers | null): void;
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
  /** A small picture of the canvas for the results page; never taken inside a timing window. */
  thumbnail?(): Promise<Blob | undefined>;
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

/** The suites of the sphere water page, oldest first. */
export const WATER_LOD_SPIKE_SPHERE_TEST_HISTORY: readonly TestSuite<WaterLodSpikeSphereTestSettings>[] = [WATER_LOD_SPIKE_SPHERE_COST_V1];

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
 * Testing adapter for the sphere water page: holds the pose and the layer set the case asks for, waits for the page to draw, and
 * measures the cost arms (see {@link WATER_LOD_SPIKE_SPHERE_TEST_HISTORY}). Nothing here switches `<scene>`'s wireframe.
 */
export function createWaterLodSpikeSphereTestAdapter(host: WaterLodSpikeSphereTestHost): TestRunAdapter<WaterLodSpikeSphereTestSettings, boolean> {
  return simpleAdapter<WaterLodSpikeSphereTestSettings, boolean>({
    windowModes: false,
    capture: () => true,
    apply: (scenario) => host.setPose(scenario.settings.pose),
    ...(host.thumbnail
      ? {
          thumbnail: async (_scenario: unknown, context: TestContext) => {
            if (context.repetition > 1) return undefined;
            const image = await host.thumbnail?.();
            return image ? [image] : undefined;
          },
        }
      : {}),
    restore: () => {
      host.setPose(null);
      host.setLayers(null);
    },
    ready: async (context) => {
      while (!host.ready()) await context.wait(100);
    },
    environment: () => host.environment(),
    measure: async (_scenario, context): Promise<TestObservation> => measureCost(host, context),
  });
}
