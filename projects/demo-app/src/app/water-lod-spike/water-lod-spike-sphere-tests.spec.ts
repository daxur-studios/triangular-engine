import type { TestContext, TestScenario } from 'triangular-engine/testing';
import type { SpherePoseId } from './core/water-lod-spike-sphere-poses';
import {
  SPHERE_COST_ARMS,
  SPHERE_STACK_MAX_MS,
  WATER_LOD_SPIKE_SPHERE_TEST_HISTORY,
  createWaterLodSpikeSphereTestAdapter,
  sphereCostOrder,
  type IWaterLodSpikeSphereLayers,
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
