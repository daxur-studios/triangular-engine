import type { TestContext, TestScenario } from 'triangular-engine/testing';
import type { SpherePoseId } from './core/water-lod-spike-sphere-poses';
import {
  SPHERE_COST_ARMS,
  SPHERE_DENSITY_ARMS,
  SPHERE_HORIZON_ARMS,
  SPHERE_SPLIT_ARMS,
  SPHERE_STACK_MAX_MS,
  SPHERE_WATER_ALONE_ARMS,
  SPHERE_STILL_LEAF_CAPS,
  SPHERE_STILL_WAVE_TIME_S,
  WATER_LOD_SPIKE_SPHERE_TEST_HISTORY,
  createWaterLodSpikeSphereTestAdapter,
  sphereCostOrder,
  sphereSplitOrder,
  sphereStillVariant,
  type IWaterLodSpikeSphereLayers,
  type IWaterLodSpikeSphereVariant,
  type SphereWaterAloneArmId,
  type WaterLodSpikeSphereTestHost,
  type WaterLodSpikeSphereTestSettings,
} from './water-lod-spike-sphere-tests';

interface ICosts {
  readonly land: number;
  readonly water: number;
  readonly atmosphere: number;
  readonly waterOnly?: number;
}

/**
 * A fake page whose GPU frame is the sum of what its layers cost, and whose layers draw `lag` frames after they are switched
 * (so the case's wait for the draw is exercised).
 */
function makeHost(costs: ICosts, overrides: Partial<WaterLodSpikeSphereTestHost> = {}, lag = 0): WaterLodSpikeSphereTestHost & { calls: string[]; layers: IWaterLodSpikeSphereLayers } {
  const calls: string[] = [];
  let wanted: IWaterLodSpikeSphereLayers = { land: true, water: true, atmosphere: false };
  let shown: IWaterLodSpikeSphereLayers = wanted;
  let framesSinceSwitch = 0;
  const host = {
    calls,
    get layers() { return wanted; },
    ready: () => true,
    setPose: (id: SpherePoseId | null) => calls.push(`pose:${id}`),
    setLayers: (layers: IWaterLodSpikeSphereLayers | null) => {
      calls.push(`layers:${layers ? `${+layers.land}${+layers.water}${+layers.atmosphere}` : 'page'}`);
      wanted = layers ?? { land: true, water: true, atmosphere: false };
      framesSinceSwitch = 0;
    },
    drawn: () => {
      if (framesSinceSwitch >= lag) shown = wanted;
      return shown;
    },
    counts: () => ({ drawCalls: 3, triangles: 1200 }),
    beginFrameSampling: () => undefined,
    endFrameSampling: () => [16.7, 120, 16.6],
    takeCpuFrameMs: () => [2.5, 2.6, 2.4],
    gpuFrameMs: () => {
      const { land, water, atmosphere } = wanted;
      if (!land && water) return costs.waterOnly ?? costs.water;
      return (land ? costs.land : 0) + (water ? costs.water : 0) + (atmosphere ? costs.atmosphere : 0);
    },
    waitFrames: async (count: number) => { framesSinceSwitch += count; },
    environment: () => ({ backend: 'webgpu' }),
    ...overrides,
  };
  return host as WaterLodSpikeSphereTestHost & { calls: string[]; layers: IWaterLodSpikeSphereLayers };
}

function makeContext(): TestContext {
  return {
    signal: new AbortController().signal,
    profile: 'visible-browser',
    mode: 'standard',
    repetition: 1,
    wait: async () => undefined,
    measureWindow: async () => { throw new Error('windowModes is false; measureWindow is not used'); },
  } as unknown as TestContext;
}

const SCENARIO: TestScenario<WaterLodSpikeSphereTestSettings> = {
  id: 'coast-300m',
  label: 'Coast',
  settings: { pose: 'coast-300m', measure: 'cost' },
  durationMs: 1000,
  warmupMs: 500,
};

const metric = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeSphereTestAdapter>['measure']>>, name: string) =>
  observation.metrics.find((m) => m.name === name);
const check = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeSphereTestAdapter>['measure']>>, fragment: string) =>
  observation.checks?.find((c) => c.name.includes(fragment));

describe('water-lod-spike sphere cost suite', () => {
  it('has one case per pose, four poses, all performance cases of one suite version', () => {
    const [suite] = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY;
    expect(suite.id).toBe('water-lod-spike-sphere-cost');
    expect(suite.version).toBe(1);
    expect(suite.purpose).toBe('performance');
    expect(suite.scenarios.map((s) => s.settings.pose)).toEqual(['orbit', 'mid-20km', 'coast-300m', 'eye-2m']);
    expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(4);
  });

  it('measures the five arms and then the five again in the opposite order', () => {
    const order = sphereCostOrder().map((arm) => arm.id);
    expect(order.length).toBe(10);
    expect(order.slice(0, 5)).toEqual(SPHERE_COST_ARMS.map((arm) => arm.id));
    expect(order.slice(5)).toEqual([...SPHERE_COST_ARMS].reverse().map((arm) => arm.id));
  });

  it('reads the marginal costs as differences of arm means', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(metric(observation, 'cost of the water on the land (land + water minus land)')?.samples[0]).toBeCloseTo(0.3, 9);
    expect(metric(observation, 'cost of the water on land and atmosphere')?.samples[0]).toBeCloseTo(0.3, 9);
    expect(metric(observation, 'cost of the atmosphere on the land')?.samples[0]).toBeCloseTo(0.8, 9);
    expect(metric(observation, 'cost of the atmosphere on land and water')?.samples[0]).toBeCloseTo(0.8, 9);
    const stack = metric(observation, 'GPU frame, land + water + atmosphere')?.samples ?? [];
    expect(stack.length).toBe(2);
    stack.forEach((sample) => expect(sample).toBeCloseTo(3.1, 9));
    expect(metric(observation, 'longest frame after the switch, land')?.samples).toEqual([120, 120]);
    expect(metric(observation, 'CPU frame, water')?.samples.length).toBe(2);
  });

  it('passes every gate when the water is cheap and the stack is inside the budget', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(observation.checks?.length).toBe(5);
    expect(observation.checks?.every((c) => c.passed)).toBe(true);
  });

  it('fails the water gate when the water costs more than 0.5 ms on the land', async () => {
    const host = makeHost({ land: 2, water: 0.9, atmosphere: 0.8 });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(check(observation, 'the water costs at most')?.passed).toBe(false);
    expect(check(observation, 'whole stack')?.passed).toBe(true);
  });

  it('fails the stack budget when the three layers together take more than 8.3 ms', async () => {
    const host = makeHost({ land: 6, water: 0.4, atmosphere: 2.5 });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(6 + 0.4 + 2.5).toBeGreaterThan(SPHERE_STACK_MAX_MS);
    expect(check(observation, 'whole stack')?.passed).toBe(false);
    expect(check(observation, 'the water costs at most')?.passed).toBe(true);
  });

  it('cannot read a difference when the terrain frame is shorter than the timestamp resolution allows', async () => {
    const host = makeHost({ land: 0.1, water: 0.1, atmosphere: 0.1 });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(check(observation, 'at least')?.passed).toBe(false);
  });

  it('fails the GPU check when the timestamps are unsupported', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 }, { gpuFrameMs: () => null });
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(check(observation, 'GPU time measured')?.passed).toBe(false);
  });

  it('waits for a layer that draws a few frames after it is switched', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 }, {}, 12);
    const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(check(observation, 'every layer draws')?.passed).toBe(true);
  });

  it('reports a layer that never draws', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 });
    // The water never shows, whatever is asked; shorten the wait so the test does not take a minute.
    const never = { ...host, drawn: () => ({ land: true, water: false, atmosphere: false }), waitFrames: async () => { await new Promise((r) => setTimeout(r, 0)); } };
    const spy = spyOn(performance, 'now');
    let now = 0;
    spy.and.callFake(() => (now += 20_000));
    const observation = await createWaterLodSpikeSphereTestAdapter(never as WaterLodSpikeSphereTestHost).measure(SCENARIO, makeContext());
    expect(check(observation, 'every layer draws')?.passed).toBe(false);
  });

  describe('split suite', () => {
    const SPLIT: TestScenario<WaterLodSpikeSphereTestSettings> = { ...SCENARIO, settings: { pose: 'coast-300m', measure: 'split' } };

    it('is the second suite of the history with one case per pose', () => {
      const suite = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[1];
      expect(suite.id).toBe('water-lod-spike-sphere-split');
      expect(suite.scenarios.every((s) => s.settings.measure === 'split')).toBe(true);
      expect(suite.scenarios.length).toBe(4);
    });

    it('measures the seven arms and then the seven again in the opposite order', () => {
      const order = sphereSplitOrder().map((arm) => arm.id);
      expect(order.length).toBe(14);
      expect(order.slice(7)).toEqual([...SPHERE_SPLIT_ARMS].reverse().map((arm) => arm.id));
    });

    it('holds each variant, reports each arm over the land, and hands the page its own back', async () => {
      const held: (IWaterLodSpikeSphereVariant | null)[] = [];
      let variant: IWaterLodSpikeSphereVariant | null = null;
      const host = makeHost({ land: 2, water: 1, atmosphere: 0 }, {
        setWaterVariant: (v) => { held.push(v); variant = v; },
        gpuFrameMs: () => {
          if (!host.layers.water) return 2;
          const v = variant as IWaterLodSpikeSphereVariant | null;
          return 2 + (v?.quadrature === false ? 0.2 : 0.6) + (v?.depthRead === false ? 0.1 : 0.2) + (v?.quality === 'low' ? 0.1 : 0.4);
        },
      });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SPLIT, makeContext());
      const cost = (id: string) => metric(observation, `cost over the land, ${id}`)?.samples[0];
      expect(cost('full')).toBeCloseTo(1.2, 9);
      expect(cost('cheapest')).toBeCloseTo(0.4, 9);
      expect(cost('no quadrature')).toBeCloseTo(0.8, 9);
      expect(metric(observation, 'GPU frame, low quality')?.samples.length).toBe(2);
      expect(held.length).toBe(15);
      expect(held[held.length - 1]).toBeNull();
      expect(observation.checks?.every((c) => c.passed)).toBe(true);
    });

    it('fails the variant check on a page that cannot hold one', async () => {
      const host = makeHost({ land: 2, water: 1, atmosphere: 0 });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(SPLIT, makeContext());
      expect(check(observation, 'hold a water variant')?.passed).toBe(false);
    });
  });

  describe('density suite', () => {
    const DENSITY: TestScenario<WaterLodSpikeSphereTestSettings> = { ...SCENARIO, settings: { pose: 'orbit', measure: 'density' } };

    it('is the third suite of the history with one case per pose', () => {
      const suite = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[2];
      expect(suite.id).toBe('water-lod-spike-sphere-density');
      expect(suite.scenarios.every((s) => s.settings.measure === 'density')).toBe(true);
      expect(suite.scenarios.length).toBe(4);
    });

    it('starts with the empty-frame baseline and measures every arm twice, the second pass reversed', () => {
      expect(SPHERE_DENSITY_ARMS[0].variant).toBeNull();
      const order = sphereSplitOrder(SPHERE_DENSITY_ARMS).map((arm) => arm.id);
      expect(order.length).toBe(SPHERE_DENSITY_ARMS.length * 2);
      expect(order.slice(SPHERE_DENSITY_ARMS.length)).toEqual([...SPHERE_DENSITY_ARMS].reverse().map((arm) => arm.id));
    });

    it('draws the water alone, holds each variant, reports each arm over the empty frame and hands the page its own back', async () => {
      const held: (IWaterLodSpikeSphereVariant | null)[] = [];
      let variant: IWaterLodSpikeSphereVariant | null = null;
      const host = makeHost({ land: 2, water: 1, atmosphere: 0 }, {
        setWaterVariant: (v) => { held.push(v); variant = v; },
        gpuFrameMs: () => {
          if (!host.layers.water) return 0.1;
          expect(host.layers.land).toBe(false);
          const v = variant as IWaterLodSpikeSphereVariant | null;
          return 0.1 + (v?.waves === false ? 0.2 : 1) + (v?.mesh?.leafCap === 256 ? 0 : 0.5);
        },
      });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(DENSITY, makeContext());
      const cost = (id: string) => metric(observation, `cost over an empty frame, ${id}`)?.samples[0];
      expect(cost('ultra')).toBeCloseTo(1.5, 9);
      expect(cost('ultra, no waves')).toBeCloseTo(0.7, 9);
      expect(cost('cap 256')).toBeCloseTo(1, 9);
      expect(held.length).toBe(SPHERE_DENSITY_ARMS.length * 2 + 1);
      expect(held[held.length - 1]).toBeNull();
      expect(observation.checks?.every((c) => c.passed)).toBe(true);
    });
  });

  describe('horizon suite', () => {
    const HORIZON: TestScenario<WaterLodSpikeSphereTestSettings> = { ...SCENARIO, settings: { pose: 'orbit', measure: 'horizon' } };

    it('is the fourth suite of the history with one case per pose', () => {
      const suite = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[3];
      expect(suite.id).toBe('water-lod-spike-sphere-horizon');
      expect(suite.scenarios.every((s) => s.settings.measure === 'horizon')).toBe(true);
      expect(suite.scenarios.length).toBe(4);
    });

    it('starts with the empty frame, then the ultra tier as shipped without the cull, and every other arm has it', () => {
      expect(SPHERE_HORIZON_ARMS[0].variant).toBeNull();
      expect(SPHERE_HORIZON_ARMS[1].variant?.horizon).toBeUndefined();
      for (const arm of SPHERE_HORIZON_ARMS.slice(2)) expect(arm.variant?.horizon).withContext(arm.id).toBe(true);
      const order = sphereSplitOrder(SPHERE_HORIZON_ARMS).map((arm) => arm.id);
      expect(order.slice(SPHERE_HORIZON_ARMS.length)).toEqual([...SPHERE_HORIZON_ARMS].reverse().map((arm) => arm.id));
    });

    it('draws the water alone and reports the cost of each arm over the empty frame', async () => {
      let variant: IWaterLodSpikeSphereVariant | null = null;
      const host = makeHost({ land: 2, water: 1, atmosphere: 0 }, {
        setWaterVariant: (v) => { variant = v; },
        gpuFrameMs: () => {
          if (!host.layers.water) return 0.1;
          expect(host.layers.land).toBe(false);
          const v = variant as IWaterLodSpikeSphereVariant | null;
          return 0.1 + (v?.horizon === true ? 0.7 : 1);
        },
      });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(HORIZON, makeContext());
      const cost = (id: string) => metric(observation, `cost over an empty frame, ${id}`)?.samples[0];
      expect(cost('ultra')).toBeCloseTo(1, 9);
      expect(cost('ultra, horizon')).toBeCloseTo(0.7, 9);
      expect(observation.checks?.every((c) => c.passed)).toBe(true);
    });
  });

  describe('stills suite', () => {
    const suite = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[4];
    const STILL: TestScenario<WaterLodSpikeSphereTestSettings> = {
      id: 'coast-300m-2048',
      label: 'Coast, 2048 leaves',
      settings: { pose: 'coast-300m', measure: 'stills', leafCap: 2048 },
      durationMs: 1000,
      warmupMs: 500,
    };

    it('is a visual-review suite with one case per pose and leaf cap, grouped by pose', () => {
      expect(suite.id).toBe('water-lod-spike-sphere-stills');
      expect(suite.version).toBe(1);
      expect(suite.purpose).toBe('functional');
      expect(suite.requiresVisualReview).toBe(true);
      expect(SPHERE_STILL_LEAF_CAPS).toEqual([4096, 2048, 1024]);
      expect(suite.scenarios.length).toBe(12);
      expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(12);
      expect(suite.scenarios.slice(0, 3).map((s) => [s.settings.pose, s.settings.leafCap])).toEqual([['orbit', 4096], ['orbit', 2048], ['orbit', 1024]]);
      expect(suite.scenarios.every((s) => s.settings.measure === 'stills')).toBe(true);
    });

    it('holds the full stack at the case\'s leaf cap with the horizon cull and a fixed wave clock, and leaves it up for the picture', async () => {
      const variants: (IWaterLodSpikeSphereVariant | null)[] = [];
      const times: (number | null)[] = [];
      const host = makeHost({ land: 2, water: 1, atmosphere: 1 }, {
        setWaterVariant: (v) => { variants.push(v); },
        holdWaveTime: (t) => { times.push(t); },
      });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(STILL, makeContext());
      expect(host.layers).toEqual({ land: true, water: true, atmosphere: true });
      expect(variants).toEqual([sphereStillVariant(2048)]);
      expect(variants[0]?.horizon).toBe(true);
      expect(variants[0]?.mesh).toEqual({ cellPixels: 4, leafCap: 2048 });
      expect(times).toEqual([SPHERE_STILL_WAVE_TIME_S]);
      expect(metric(observation, 'water leaf cap')?.samples).toEqual([2048]);
      expect(metric(observation, 'GPU frame, land, water and atmosphere')?.samples[0]).toBeCloseTo(4, 9);
      expect(observation.checks?.every((c) => c.passed)).toBe(true);
    });

    it('fails the settled check when the triangle count changes during the window', async () => {
      let triangles = 1000;
      const host = makeHost({ land: 2, water: 1, atmosphere: 1 }, {
        setWaterVariant: () => undefined,
        holdWaveTime: () => undefined,
        counts: () => ({ drawCalls: 3, triangles: (triangles += 100) }),
      });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(STILL, makeContext());
      expect(check(observation, 'settled')?.passed).toBe(false);
    });

    it('fails the host check when the page cannot hold a variant or the wave clock', async () => {
      const observation = await createWaterLodSpikeSphereTestAdapter(makeHost({ land: 2, water: 1, atmosphere: 1 })).measure(STILL, makeContext());
      expect(check(observation, 'can hold')?.passed).toBe(false);
    });

    it('takes the still, not the thumbnail, for a stills case, and gives the wave clock back on restore', async () => {
      const still = new Blob(['still']);
      const thumb = new Blob(['thumb']);
      const times: (number | null)[] = [];
      const host = makeHost({ land: 2, water: 1, atmosphere: 1 }, { thumbnail: async () => thumb, still: async () => still, holdWaveTime: (t) => { times.push(t); } });
      const adapter = createWaterLodSpikeSphereTestAdapter(host);
      expect(await adapter.thumbnail?.(STILL, makeContext())).toEqual([still]);
      expect(await adapter.thumbnail?.(SCENARIO, makeContext())).toEqual([thumb]);
      await adapter.restore(await adapter.capture(makeContext()), makeContext());
      expect(times).toEqual([null]);
    });
  });

  describe('water-alone density suite v2', () => {
    const suite = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[5];
    const caseOf = (arm: SphereWaterAloneArmId): TestScenario<WaterLodSpikeSphereTestSettings> => ({
      id: `eye-2m-${arm}`, label: `Eye ${arm}`, settings: { pose: 'eye-2m', measure: 'water-alone', arm }, durationMs: 1000, warmupMs: 500,
    });

    it('is appended after the earlier versions, which stay as they were', () => {
      expect(WATER_LOD_SPIKE_SPHERE_TEST_HISTORY.length).toBe(6);
      expect(WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[2].version).toBe(1);
      expect(WATER_LOD_SPIKE_SPHERE_TEST_HISTORY[2].scenarios.every((s) => s.settings.measure === 'density')).toBe(true);
      expect([suite.id, suite.version, suite.purpose]).toEqual(['water-lod-spike-sphere-density', 2, 'performance']);
      expect(suite.expectedGpuVendor).toBe('nvidia');
    });

    it('has A and its partner for each of B, C and D at each of four views, alternating A, partner in each group', () => {
      expect(suite.scenarios.length).toBe(24);
      expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(24);
      expect([...new Set(suite.scenarios.map((s) => s.settings.pose))]).toEqual(['eye-2m', 'coast-300m', 'mid-20km', 'orbit']);
      const groups = new Map<string, string[]>();
      for (const s of suite.scenarios) groups.set(s.ablation?.group ?? '', [...(groups.get(s.ablation?.group ?? '') ?? []), `${s.ablation?.arm}:${s.settings.arm}`]);
      expect(groups.size).toBe(12);
      expect(groups.get('eye-2m-waves')).toEqual(['A:A', 'B:B']);
      expect(groups.get('coast-300m-pixels')).toEqual(['A:A', 'B:C']);
      expect(groups.get('orbit-patches')).toEqual(['A:A', 'B:D']);
      expect(suite.ablation?.metrics).toEqual(['GPU frame, water alone']);
    });

    it('budgets only A: 1.5 ms median at the eye and the coast, 1.0 ms at 20 km, none at orbit', () => {
      const budgeted = suite.scenarios.filter((s) => s.budgets);
      expect(budgeted.every((s) => s.settings.arm === 'A')).toBe(true);
      const limit = (pose: string) => [...new Set(budgeted.filter((s) => s.settings.pose === pose).map((s) => s.budgets?.['GPU frame, water alone']?.median))];
      expect(limit('eye-2m')).toEqual([1.5]);
      expect(limit('coast-300m')).toEqual([1.5]);
      expect(limit('mid-20km')).toEqual([1.0]);
      expect(limit('orbit')).toEqual([]);
    });

    it('defines the four settings: A 256 patches, B waves off, C half the pixels, D 1,024 patches', () => {
      expect(SPHERE_WATER_ALONE_ARMS.A.mesh).toEqual({ cellPixels: 4, leafCap: 256 });
      expect(SPHERE_WATER_ALONE_ARMS.A.waves).toBeUndefined();
      expect(SPHERE_WATER_ALONE_ARMS.B).toEqual({ ...SPHERE_WATER_ALONE_ARMS.A, waves: false });
      expect(SPHERE_WATER_ALONE_ARMS.C).toEqual({ ...SPHERE_WATER_ALONE_ARMS.A, pixelScale: 0.5 });
      expect(SPHERE_WATER_ALONE_ARMS.D.mesh?.leafCap).toBe(1024);
    });

    it('holds water alone at the case\'s setting and reports five GPU samples', async () => {
      const variants: (IWaterLodSpikeSphereVariant | null)[] = [];
      const host = makeHost({ land: 9, water: 1.2, atmosphere: 9 }, { setWaterVariant: (v) => { variants.push(v); } });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(caseOf('B'), makeContext());
      expect(host.layers).toEqual({ land: false, water: true, atmosphere: false });
      expect(variants).toEqual([SPHERE_WATER_ALONE_ARMS.B]);
      expect(metric(observation, 'GPU frame, water alone')?.samples).toEqual([1.2, 1.2, 1.2, 1.2, 1.2]);
      expect(metric(observation, 'triangles, water alone')?.samples).toEqual([1200]);
      expect(observation.checks?.every((c) => c.passed)).toBe(true);
    });

    it('checks that C draws about half the pixels and the others all of them', async () => {
      let pixels = 1000;
      const host = makeHost({ land: 9, water: 1, atmosphere: 9 }, {
        drawingBufferPixels: () => pixels,
        setWaterVariant: (v) => { pixels = v?.pixelScale === undefined ? 1000 : 1000 * v.pixelScale; },
      });
      const adapter = createWaterLodSpikeSphereTestAdapter(host);
      expect(check(await adapter.measure(caseOf('C'), makeContext()), 'pixels')?.passed).toBe(true);
      pixels = 1000;
      expect(check(await adapter.measure(caseOf('A'), makeContext()), 'pixel')?.passed).toBe(true);
      const unchanged = makeHost({ land: 9, water: 1, atmosphere: 9 }, { drawingBufferPixels: () => 1000, setWaterVariant: () => undefined });
      expect(check(await createWaterLodSpikeSphereTestAdapter(unchanged).measure(caseOf('C'), makeContext()), 'pixels')?.passed).toBe(false);
    });

    it('fails when the timestamps are unsupported or the page cannot hold a variant', async () => {
      const host = makeHost({ land: 9, water: 1, atmosphere: 9 }, { gpuFrameMs: () => null });
      const observation = await createWaterLodSpikeSphereTestAdapter(host).measure(caseOf('A'), makeContext());
      expect(check(observation, 'GPU time')?.passed).toBe(false);
      expect(check(observation, 'can hold')?.passed).toBe(false);
    });
  });

  it('holds the pose for a case and hands the page its own layers and camera back afterwards', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 });
    const adapter = createWaterLodSpikeSphereTestAdapter(host);
    const context = makeContext();
    const snapshot = await adapter.capture(context);
    await adapter.apply(SCENARIO, context);
    await adapter.restore(snapshot, context);
    expect(host.calls).toEqual(['pose:coast-300m', 'pose:null', 'layers:page']);
  });

  it('puts the layers back to the page\'s own at the end of a measurement', async () => {
    const host = makeHost({ land: 2, water: 0.3, atmosphere: 0.8 });
    await createWaterLodSpikeSphereTestAdapter(host).measure(SCENARIO, makeContext());
    expect(host.calls[host.calls.length - 1]).toBe('layers:page');
    expect(host.calls.filter((call) => call.startsWith('layers:') && call !== 'layers:page').length).toBe(10);
  });
});
