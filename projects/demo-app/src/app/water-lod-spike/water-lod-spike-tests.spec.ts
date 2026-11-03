import type { TestContext, TestScenario } from 'triangular-engine/testing';
import type { ILuminanceImage } from './core/water-lod-spike-image-metrics';
import type { ILeafCull } from './core/water-lod-spike-land';
import type { IPathError, IPrecisionReport } from './core/water-lod-spike-precision';
import {
  createWaterLodSpikeTestAdapter,
  WATER_LOD_SPIKE_TEST_HISTORY,
  type WaterLodSpikeTestHost,
  type WaterLodSpikeTestSettings,
} from './water-lod-spike-tests';

const WIDTH = 32;
const HEIGHT = 200;

const pathError = (maxRad: number): IPathError => ({ maxRad, rmsRad: maxRad / 3, pairs: 2000, worstWavelengthM: 0.5, worstDistanceM: 30 });

/** A Q5 report: anchor error `anchorRad` and naive error `naiveRad` at both wave times. */
function precisionReport(anchorRad = 2e-5, naiveRad = 0.4, backend = 'webgpu'): IPrecisionReport {
  const entry = (timeS: number) => ({
    timeS,
    gpuNaive: pathError(naiveRad),
    gpuAnchor: pathError(anchorRad),
    emulatedNaive: pathError(naiveRad),
    emulatedAnchor: pathError(anchorRad),
    gpuAnchorSineError: 1e-4,
  });
  return { backend, radiusM: 600_000, eyeHeightM: 2, waves: 64, samples: 72, cases: [entry(0), entry(3600)] };
}

/** A leaf report for a shore view: a quarter of the drawn leaves are under land, and the centre-only control is wrong on some. */
function leafCull(overrides: Partial<ILeafCull> = {}): ILeafCull {
  return {
    leaves: 4096, drawn: 1000, dryDrawn: 250, dryDrawnByCentre: 290, centreWrongCalls: 40, conservativeWrongCalls: 0, wetDrawn: 750,
    checked: 1000, covered: 0, unmet: 120, capHit: true, deepestLevel: 14, wetEdgeMeanM: 90, ...overrides,
  };
}

/**
 * A fake page whose frames depend on the filter: with the filter off the water rows are a pixel checkerboard whose
 * phase follows the jitter (aliasing); with it on they are flat grey.
 */
function makeHost(overrides: Partial<WaterLodSpikeTestHost> = {}): WaterLodSpikeTestHost & { calls: string[] } {
  const calls: string[] = [];
  let wireframe = false;
  let filter = true;
  return {
    calls,
    ready: () => true,
    wireframe: () => wireframe,
    setWireframe: (enabled) => {
      wireframe = enabled;
      calls.push(`setWireframe:${enabled}`);
    },
    counts: () => ({ drawCalls: 3, triangles: 1200 }),
    beginFrameSampling: () => calls.push('begin'),
    endFrameSampling: () => {
      calls.push('end');
      return [16.7, 16.6, 6.1];
    },
    takeCpuFrameMs: () => [2.5, 2.6, 2.4],
    gpuFrameMs: () => 0.8,
    setView: (view) => calls.push(`setView:${view ? 'held' : 'free'}`),
    setFilter: (enabled) => {
      filter = enabled;
    },
    setTransfer: () => undefined,
    setPixelRatio: () => undefined,
    setQuality: () => undefined,
    waitFrames: async () => undefined,
    readFrame: (jitterX, jitterY): ILuminanceImage => {
      const values = new Float32Array(WIDTH * HEIGHT);
      const shift = Math.round(jitterX * 3);
      for (let y = 50; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) values[y * WIDTH + x] = filter ? 156.3 : (x + shift + 3000) % 3 === 0 ? 255 : 0;
      }
      return { width: WIDTH, height: HEIGHT, values };
    },
    horizonRow: () => 44,
    runPrecisionProbe: async () => precisionReport(),
    setLand: () => undefined,
    landDrawn: () => true,
    landLeaves: () => leafCull(),
    landAudit: () => leafCull({ checked: 4096 }),
    setCull: () => undefined,
    coverActive: () => false,
    setWaterNoise: () => undefined,
    setShore: () => undefined,
    shoreAudit: () => ({ dryPoints: 9000, violations: 0, maxExcessM: 0, meanExcessM: 0 }),
    setFoam: () => undefined,
    setDepthColour: () => undefined,
    shoreLookAudit: () => ({ wetPoints: 20000, edgePoints: 900, edgeGaps: 0, farFoam: 0, shallowDeepness: 0.05, deepDeepness: 0.95 }),
    setBakedTerrain: () => undefined,
    terrainReadAudit: () => ({ points: 40000, maxDepthErrorM: 0.1, meanDepthErrorM: 0.01, signFlips: 12, clearFlips: 0, nearWaterline: 900 }),
    terrainReadInfo: () => ({ k: 11, texelM: 48.8, megabytes: 16.8, bakeMs: 300 }),
    environment: () => ({ backend: 'webgpu' }),
    ...overrides,
  };
}

function makeContext(calls: string[]): TestContext {
  return {
    signal: new AbortController().signal,
    profile: 'visible-browser',
    mode: 'standard',
    repetition: 1,
    wait: async (milliseconds: number) => {
      calls.push(`wait:${milliseconds}`);
    },
    measureWindow: async () => {
      throw new Error('windowModes is false; measureWindow is not used');
    },
  } as unknown as TestContext;
}

const SOLID_SCENARIO: TestScenario<WaterLodSpikeTestSettings> = {
  id: 'solid',
  label: 'Solid water',
  settings: { wireframe: false },
  durationMs: 3000,
  warmupMs: 1500,
};

const ALIASING_SCENARIO: TestScenario<WaterLodSpikeTestSettings> = {
  id: 'grazing',
  label: 'Grazing view',
  settings: { wireframe: false, measure: 'aliasing', view: { position: [0, 12, 0], target: [0, 0, -300] } },
  durationMs: 1000,
  warmupMs: 500,
};

describe('createWaterLodSpikeTestAdapter', () => {
  it('samples frame intervals only across the measured window', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);
    const context = makeContext(host.calls);

    const observation = await adapter.measure(SOLID_SCENARIO, context);

    expect(host.calls).toEqual(['begin', 'wait:1000', 'wait:1000', 'wait:1000', 'end']);
    const frameInterval = observation.metrics.find((metric) => metric.name === 'frame interval');
    expect(frameInterval?.samples).toEqual([16.7, 16.6, 6.1]);
  });

  it('returns a copy of the frame samples, not the host array', async () => {
    const hostFrames = [16.7, 6.1];
    const host = makeHost({ endFrameSampling: () => hostFrames });
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure(SOLID_SCENARIO, makeContext(host.calls));
    const frameInterval = observation.metrics.find((metric) => metric.name === 'frame interval');
    hostFrames.push(99);

    expect(frameInterval?.samples).toEqual([16.7, 6.1]);
  });

  it('records GPU frame time only for cases with a fixed view', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);

    const free = await adapter.measure(SOLID_SCENARIO, makeContext(host.calls));
    const held = await adapter.measure({ ...SOLID_SCENARIO, settings: { wireframe: false, view: ALIASING_SCENARIO.settings.view } }, makeContext(host.calls));

    expect(free.metrics.some((metric) => metric.name === 'GPU frame')).toBe(false);
    expect(held.metrics.find((metric) => metric.name === 'GPU frame')?.samples).toEqual([0.8, 0.8, 0.8]);
  });

  it('records the CPU frame time of the measured window', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure(SOLID_SCENARIO, makeContext(host.calls));

    expect(observation.metrics.find((metric) => metric.name === 'CPU frame')?.samples).toEqual([2.5, 2.6, 2.4]);
  });

  it('reports a failed check when the water body has not drawn', async () => {
    const host = makeHost({ counts: () => ({ drawCalls: 0, triangles: 0 }) });
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure(SOLID_SCENARIO, makeContext(host.calls));

    expect(observation.checks?.find((check) => check.name === 'water body draws')?.passed).toBe(false);
    expect(observation.checks?.find((check) => check.name === 'triangles drawn')?.passed).toBe(false);
  });

  it('applies the scenario wireframe and view, then restores them', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);
    const context = makeContext(host.calls);

    const snapshot = await adapter.capture(context);
    await adapter.apply({ ...ALIASING_SCENARIO, settings: { ...ALIASING_SCENARIO.settings, wireframe: true } }, context);
    await adapter.restore(snapshot, context);

    expect(host.calls).toEqual(['setWireframe:true', 'setView:held', 'setWireframe:false', 'setView:free']);
  });

  it('holds the scenario quality tier and hands the page its own back afterwards', async () => {
    const tiers: (string | null)[] = [];
    const host = makeHost({ setQuality: (id) => tiers.push(id) });
    const adapter = createWaterLodSpikeTestAdapter(host);
    const context = makeContext(host.calls);

    const snapshot = await adapter.capture(context);
    await adapter.apply({ ...SOLID_SCENARIO, settings: { wireframe: false, quality: 'low' } }, context);
    await adapter.restore(snapshot, context);

    expect(tiers).toEqual(['low', null]);
  });

  it('sweeps every quality tier at the grazing and looking-down views in the performance and aliasing suites', () => {
    const latest = (id: string) => WATER_LOD_SPIKE_TEST_HISTORY.filter((suite) => suite.id === id).reduce((a, b) => (b.version > a.version ? b : a));
    for (const suite of [latest('water-lod-spike-performance'), latest('water-lod-spike-aliasing')]) {
      const tiers = new Set(suite.scenarios.map((scenario) => scenario.settings.quality));
      expect([...tiers].sort()).toEqual(['high', 'low', 'medium', 'ultra']);
      expect(new Set(suite.scenarios.map((scenario) => scenario.id)).size).toBe(suite.scenarios.length);
    }
    expect(latest('water-lod-spike-performance').scenarios.some((scenario) => scenario.id === 'down-ultra')).toBe(true);
  });

  it('passes the aliasing gates when the filter removes the aliasing', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure(ALIASING_SCENARIO, makeContext(host.calls));
    const metric = (name: string) => observation.metrics.find((entry) => entry.name === name)?.samples[0];

    expect(metric('shimmer, filtered')).toBe(0);
    expect(metric('shimmer, control')).toBeGreaterThan(100);
    expect(metric('water rows')).toBe(150);
    expect(observation.checks?.filter((c) => !c.passed).map((c) => JSON.stringify(c))).toEqual([]);
  });

  it('reports the metrics but no aliasing gates for an ungated case', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure({ ...ALIASING_SCENARIO, settings: { ...ALIASING_SCENARIO.settings, gated: false } }, makeContext(host.calls));

    expect(observation.metrics.some((metric) => metric.name === 'shimmer, filtered')).toBe(true);
    expect(observation.checks?.map((check) => check.name)).toEqual(['water drawn, not blank', 'water rows measured']);
  });

  it('gates ultra fully, high on colour only, and leaves medium and low ungated in the latest aliasing suite', () => {
    const suite = WATER_LOD_SPIKE_TEST_HISTORY.filter((entry) => entry.id === 'water-lod-spike-aliasing').reduce((a, b) => (b.version > a.version ? b : a));
    const expected: Record<string, boolean | 'colour'> = { ultra: true, high: 'colour', medium: false, low: false };
    for (const scenario of suite.scenarios) expect(scenario.settings.gated).toBe(expected[scenario.settings.quality ?? '']);
  });

  it('applies only the colour gate for a colour-gated case', async () => {
    const host = makeHost();
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure({ ...ALIASING_SCENARIO, settings: { ...ALIASING_SCENARIO.settings, gated: 'colour' } }, makeContext(host.calls));

    expect(observation.checks?.map((check) => check.name)).toEqual([
      'water drawn, not blank',
      'water rows measured',
      'colour matches the reference within 6/255 in every band',
    ]);
  });

  describe('precision case', () => {
    const PRECISION_SCENARIO: TestScenario<WaterLodSpikeTestSettings> = {
      id: 'sphere',
      label: 'Sphere',
      settings: { wireframe: false, measure: 'precision' },
      durationMs: 1000,
      warmupMs: 500,
    };
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);

    it('passes when the anchor path is exact enough and the naive control misses', async () => {
      const host = makeHost();
      const observation = await createWaterLodSpikeTestAdapter(host).measure(PRECISION_SCENARIO, makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'phase error, anchor, t = 3600 s')?.samples).toEqual([2e-5]);
      expect(observation.metrics.find((metric) => metric.name === 'phase error, naive, t = 0 s')?.samples).toEqual([0.4]);
    });

    it('fails when the anchor path misses the limit', async () => {
      const host = makeHost({ runPrecisionProbe: async () => precisionReport(5e-3) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(PRECISION_SCENARIO, makeContext(host.calls));

      expect(failed(observation)).toEqual([
        'Q5 anchor-relative phase within 0.001 rad at t = 0 s',
        'Q5 anchor-relative phase within 0.001 rad at t = 3600 s',
      ]);
    });

    it('fails when the naive control is as good as the anchor path (the metric could not tell them apart)', async () => {
      const host = makeHost({ runPrecisionProbe: async () => precisionReport(2e-5, 2e-5) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(PRECISION_SCENARIO, makeContext(host.calls));

      expect(failed(observation).every((name) => name.startsWith('Q5 control'))).toBe(true);
      expect(failed(observation).length).toBe(2);
    });

    it('fails off the WebGPU backend', async () => {
      const host = makeHost({ runPrecisionProbe: async () => precisionReport(2e-5, 0.4, 'webgl') });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(PRECISION_SCENARIO, makeContext(host.calls));

      expect(failed(observation)).toEqual(['ran on the WebGPU backend']);
    });

    it('is in the suite history as its own suite', () => {
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-precision');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.map((scenario) => scenario.settings.measure)).toEqual(['precision']);
    });
  });

  describe('land case', () => {
    const LAND_SCENARIO = (landExpect: 'shore' | 'open-sea', land = true): TestScenario<WaterLodSpikeTestSettings> => ({
      id: 'coast',
      label: 'Coast',
      settings: { wireframe: false, measure: 'land', land, landExpect },
      durationMs: 2000,
      warmupMs: 500,
    });
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);

    it('passes a shore view when the test is safe and the control is wrong, and reports the dry share', async () => {
      const host = makeHost();
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LAND_SCENARIO('shore'), makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'water leaves under land, share of drawn')?.samples).toEqual([0.25]);
      expect(observation.metrics.find((metric) => metric.name === 'GPU frame')?.samples.length).toBeGreaterThan(0);
    });

    it('fails when the conservative test calls a wet leaf dry', async () => {
      const host = makeHost({ landLeaves: () => leafCull({ conservativeWrongCalls: 3 }) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LAND_SCENARIO('shore'), makeContext(host.calls));

      expect(failed(observation)).toEqual(['conservative test calls no wet leaf dry']);
    });

    it('fails when the centre-only control never goes wrong (the check could not tell a safe test from an unsafe one)', async () => {
      const host = makeHost({ landLeaves: () => leafCull({ centreWrongCalls: 0 }) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LAND_SCENARIO('shore'), makeContext(host.calls));

      expect(failed(observation)).toEqual(['control: the centre-only test calls wet leaves dry']);
    });

    it('expects no dry leaf over open sea', async () => {
      const host = makeHost({ landLeaves: () => leafCull({ dryDrawn: 5, wetDrawn: 995 }) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LAND_SCENARIO('open-sea'), makeContext(host.calls));

      expect(failed(observation)).toEqual(['open sea has no leaf under land']);
    });

    it('fails when land was asked for and does not draw', async () => {
      const host = makeHost({ landDrawn: () => false });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LAND_SCENARIO('shore'), makeContext(host.calls));

      expect(failed(observation)).toEqual(['land drawn when asked']);
    });

    it('sets the land for the case and puts the page back afterwards', async () => {
      const lands: (boolean | null)[] = [];
      const host = makeHost({ setLand: (enabled) => lands.push(enabled) });
      const adapter = createWaterLodSpikeTestAdapter(host);
      const context = makeContext(host.calls);
      const snapshot = await adapter.capture(context);
      await adapter.apply(LAND_SCENARIO('shore', false), context);
      await adapter.restore(snapshot, context);

      expect(lands).toEqual([false, null]);
    });

    it('is in the suite history, each view with the land off and on', () => {
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-land');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.length).toBe(10);
      expect(suite?.scenarios.filter((scenario) => scenario.settings.land).length).toBe(5);
    });
  });

  describe('cull case', () => {
    const CULL_SCENARIO = (cull: boolean, landExpect: 'shore' | 'open-sea' = 'shore'): TestScenario<WaterLodSpikeTestSettings> => ({
      id: 'coast',
      label: 'Coast',
      settings: { wireframe: false, measure: 'cull', land: true, cull, landExpect },
      durationMs: 2000,
      warmupMs: 500,
    });
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);
    const culled = { coverActive: () => true, landLeaves: () => leafCull({ dryDrawn: 0, covered: 250, wetDrawn: 1000 }) };

    it('passes a shore view with the hook on when it covered leaves and no covered leaf has water', async () => {
      const host = makeHost(culled);
      const observation = await createWaterLodSpikeTestAdapter(host).measure(CULL_SCENARIO(true), makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'leaves the cover hook hid')?.samples).toEqual([250]);
      expect(observation.metrics.find((metric) => metric.name === 'mean edge of the drawn leaves that hold water')?.samples).toEqual([90]);
    });

    it('passes the same view with the hook off when nothing is covered', async () => {
      const host = makeHost();
      const observation = await createWaterLodSpikeTestAdapter(host).measure(CULL_SCENARIO(false), makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
    });

    it('fails when a leaf the hook would cover has water (the audit finds a wrong call)', async () => {
      const host = makeHost({ ...culled, landAudit: () => leafCull({ checked: 4096, conservativeWrongCalls: 2 }) });
      const observation = await createWaterLodSpikeTestAdapter(host).measure(CULL_SCENARIO(true), makeContext(host.calls));

      expect(failed(observation)).toEqual(['no leaf the hook test calls dry has a wet point']);
    });

    it('fails when the hook is on and a drawn leaf is still entirely under land, or none was covered', async () => {
      const stillDry = makeHost({ ...culled, landLeaves: () => leafCull({ dryDrawn: 4, covered: 250 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(stillDry).measure(CULL_SCENARIO(true), makeContext(stillDry.calls)))).toEqual(['no drawn leaf lies entirely under land']);
      const none = makeHost({ ...culled, landLeaves: () => leafCull({ dryDrawn: 0, covered: 0 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(none).measure(CULL_SCENARIO(true), makeContext(none.calls)))).toEqual(['the hook covered leaves']);
    });

    it('expects the hook to cover nothing over open sea, and nothing at all when it is off', async () => {
      const open = makeHost({ ...culled, landLeaves: () => leafCull({ dryDrawn: 0, covered: 3 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(open).measure(CULL_SCENARIO(true, 'open-sea'), makeContext(open.calls)))).toEqual(['open sea: the hook covers nothing']);
      const off = makeHost({ landLeaves: () => leafCull({ covered: 7 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(off).measure(CULL_SCENARIO(false), makeContext(off.calls)))).toEqual(['no hook: nothing is covered']);
    });

    it('fails when the hook state is not what the case asked for', async () => {
      const host = makeHost({ landLeaves: () => leafCull({ covered: 250, dryDrawn: 0 }), coverActive: () => false });
      expect(failed(await createWaterLodSpikeTestAdapter(host).measure(CULL_SCENARIO(true), makeContext(host.calls)))).toEqual(['cover hook installed exactly when asked']);
    });

    it('sets the hook for the case and puts the page back afterwards', async () => {
      const culls: (boolean | null)[] = [];
      const host = makeHost({ setCull: (enabled) => culls.push(enabled) });
      const adapter = createWaterLodSpikeTestAdapter(host);
      const context = makeContext(host.calls);
      const snapshot = await adapter.capture(context);
      await adapter.apply(CULL_SCENARIO(true), context);
      await adapter.restore(snapshot, context);

      expect(culls).toEqual([true, null]);
    });

    it('is in the suite history, each view with the hook off and on', () => {
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-cull');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.length).toBe(10);
      expect(suite?.scenarios.filter((scenario) => scenario.settings.cull).length).toBe(5);
      expect(suite?.scenarios.every((scenario) => scenario.settings.land === true)).toBe(true);
    });
  });

  describe('shore case', () => {
    const SHORE_SCENARIO = (waterNoise: boolean, shore: boolean): TestScenario<WaterLodSpikeTestSettings> => ({
      id: 'shore',
      label: 'Shore',
      settings: { wireframe: false, measure: 'shore', land: true, waterNoise, shore },
      durationMs: 1000,
      warmupMs: 500,
    });
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);
    const crescents = { shoreAudit: () => ({ dryPoints: 9000, violations: 120, maxExcessM: 3.2, meanExcessM: 1.1 }) };

    it('sees the crescents with the weight off (the control) and reports their size', async () => {
      const host = makeHost(crescents);
      const observation = await createWaterLodSpikeTestAdapter(host).measure(SHORE_SCENARIO(true, false), makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'largest height of water over land')?.samples).toEqual([3.2]);
    });

    it('fails the control when the gate finds nothing with the weight off', async () => {
      const host = makeHost();
      const observation = await createWaterLodSpikeTestAdapter(host).measure(SHORE_SCENARIO(false, false), makeContext(host.calls));

      expect(failed(observation)).toEqual(['control: with the weight off the water stands above the land somewhere']);
    });

    it('passes noise off with the weight on when no dry point has water above the land, and fails when one does', async () => {
      const clean = makeHost();
      expect(failed(await createWaterLodSpikeTestAdapter(clean).measure(SHORE_SCENARIO(false, true), makeContext(clean.calls)))).toEqual([]);
      const leaky = makeHost(crescents);
      expect(failed(await createWaterLodSpikeTestAdapter(leaky).measure(SHORE_SCENARIO(false, true), makeContext(leaky.calls)))).toEqual([
        'noise off, weight on: no dry point has water more than 5 cm above the land',
      ]);
    });

    it('does not gate the noise-on arm with the weight on (it is reported)', async () => {
      const host = makeHost(crescents);
      expect(failed(await createWaterLodSpikeTestAdapter(host).measure(SHORE_SCENARIO(true, true), makeContext(host.calls)))).toEqual([]);
    });

    it('sets noise and weight for the case and puts the page back afterwards', async () => {
      const noise: (boolean | null)[] = [];
      const shore: (boolean | null)[] = [];
      const host = makeHost({ setWaterNoise: (enabled) => noise.push(enabled), setShore: (enabled) => shore.push(enabled) });
      const adapter = createWaterLodSpikeTestAdapter(host);
      const context = makeContext(host.calls);
      const snapshot = await adapter.capture(context);
      await adapter.apply(SHORE_SCENARIO(false, true), context);
      await adapter.restore(snapshot, context);

      expect(noise).toEqual([false, null]);
      expect(shore).toEqual([true, null]);
    });

    it('is in the suite history with the four noise and weight arms', () => {
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-shore');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.map((scenario) => [scenario.settings.waterNoise, scenario.settings.shore])).toEqual([
        [true, false],
        [false, false],
        [true, true],
        [false, true],
      ]);
    });
  });

  describe('shore look case', () => {
    const LOOK_SCENARIO: TestScenario<WaterLodSpikeTestSettings> = {
      id: 'coast-view',
      label: 'Coast',
      settings: { wireframe: false, measure: 'shore-look', land: true, waterNoise: false, shore: true },
      durationMs: 1000,
      warmupMs: 500,
    };
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);

    /** A page whose frame gets 1 % foam-white pixels with the foam on (about 2 levels of mean luminance) and 2 levels brighter water with the depth colour on. */
    const lookHost = (overrides: Partial<WaterLodSpikeTestHost> = {}, foamAdds = true, colourAdds = true) => {
      let foam = false;
      let colour = false;
      return makeHost({
        setFoam: (enabled) => {
          foam = enabled ?? false;
        },
        setDepthColour: (enabled) => {
          colour = enabled ?? false;
        },
        readFrame: (): ILuminanceImage => {
          const values = new Float32Array(WIDTH * HEIGHT).fill(60 + (colour && colourAdds ? 2 : 0));
          if (foam && foamAdds) values.fill(250, 0, Math.round(values.length * 0.01));
          return { width: WIDTH, height: HEIGHT, values };
        },
        ...overrides,
      });
    };

    it('passes when the foam and the colour show and the audit is clean', async () => {
      const host = lookHost();
      const observation = await createWaterLodSpikeTestAdapter(host).measure(LOOK_SCENARIO, makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'bright pixel share, foam')?.samples[0]).toBeCloseTo(0.01, 3);
    });

    it('fails when the foam has a gap along the waterline or stands in deep water', async () => {
      const gap = lookHost({ shoreLookAudit: () => ({ wetPoints: 20000, edgePoints: 900, edgeGaps: 40, farFoam: 3, shallowDeepness: 0.05, deepDeepness: 0.95 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(gap).measure(LOOK_SCENARIO, makeContext(gap.calls)))).toEqual([
        'the foam has no gap along the waterline',
        'no foam deeper than the breaker zone',
      ]);
    });

    it('fails when the colour does not depend on the depth', async () => {
      const flat = lookHost({ shoreLookAudit: () => ({ wetPoints: 20000, edgePoints: 900, edgeGaps: 0, farFoam: 0, shallowDeepness: 0.9, deepDeepness: 0.95 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(flat).measure(LOOK_SCENARIO, makeContext(flat.calls)))).toEqual([
        'the water is lighter at the waterline than in deep water (by 0.3)',
      ]);
    });

    it('fails when the foam adds no pixels to the frame, or the colour changes nothing', async () => {
      const noFoam = lookHost({}, false, true);
      expect(failed(await createWaterLodSpikeTestAdapter(noFoam).measure(LOOK_SCENARIO, makeContext(noFoam.calls)))).toEqual([
        'foam brightens the coast view (mean luminance up by at least 1 level)',
      ]);
      const noColour = lookHost({}, true, false);
      expect(failed(await createWaterLodSpikeTestAdapter(noColour).measure(LOOK_SCENARIO, makeContext(noColour.calls)))).toEqual([
        'depth colour changes the coast frame',
      ]);
    });

    it('puts the page back afterwards and is in the suite history', async () => {
      const foam: (boolean | null)[] = [];
      const colour: (boolean | null)[] = [];
      const host = makeHost({ setFoam: (enabled) => foam.push(enabled), setDepthColour: (enabled) => colour.push(enabled) });
      const adapter = createWaterLodSpikeTestAdapter(host);
      const context = makeContext(host.calls);
      const snapshot = await adapter.capture(context);
      await adapter.restore(snapshot, context);

      expect(foam).toEqual([null]);
      expect(colour).toEqual([null]);
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-shore-look');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.map((scenario) => scenario.settings.measure)).toEqual(['shore-look']);
    });
  });

  describe('terrain read case', () => {
    const READ_SCENARIO: TestScenario<WaterLodSpikeTestSettings> = {
      id: 'coast-view',
      label: 'Coast',
      settings: { wireframe: false, measure: 'terrain-read', land: true, waterNoise: false, shore: true },
      durationMs: 1000,
      warmupMs: 500,
    };
    const failed = (observation: Awaited<ReturnType<ReturnType<typeof createWaterLodSpikeTestAdapter>['measure']>>) =>
      (observation.checks ?? []).filter((check) => !check.passed).map((check) => check.name);

    /** A page whose frame and GPU time follow the baked switch: `diff` levels brighter over `share` of the frame, and `ms` per frame when baked. */
    const readHost = (frame: { diff?: number; share?: number } = {}, bakedMs = 0.8, overrides: Partial<WaterLodSpikeTestHost> = {}) => {
      let baked = false;
      return makeHost({
        setBakedTerrain: (enabled) => {
          baked = enabled ?? false;
        },
        gpuFrameMs: () => (baked ? bakedMs : 0.8),
        readFrame: (): ILuminanceImage => {
          const values = new Float32Array(WIDTH * HEIGHT).fill(80);
          if (baked && frame.diff) values.fill(80 + frame.diff, 0, Math.round(values.length * (frame.share ?? 1)));
          return { width: WIDTH, height: HEIGHT, values };
        },
        ...overrides,
      });
    };

    it('passes when the baked read matches the analytic one at about the same cost', async () => {
      const host = readHost({}, 0.85);
      const observation = await createWaterLodSpikeTestAdapter(host).measure(READ_SCENARIO, makeContext(host.calls));

      expect(failed(observation)).toEqual([]);
      expect(observation.metrics.find((metric) => metric.name === 'GPU frame, baked over analytic')?.samples[0]).toBeCloseTo(0.85 / 0.8, 3);
    });

    it('fails when the baked depth is off by more than the tolerance or flips the shore away from the waterline', async () => {
      const host = readHost({}, 0.8, { terrainReadAudit: () => ({ points: 40000, maxDepthErrorM: 2.4, meanDepthErrorM: 0.3, signFlips: 300, clearFlips: 40, nearWaterline: 900 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(host).measure(READ_SCENARIO, makeContext(host.calls)))).toEqual([
        'baked depth within 0.25 m of the analytic depth',
        'no wet or dry flip more than 1 m from the waterline',
      ]);
    });

    it('fails when crescents appear with the baked read', async () => {
      const host = readHost({}, 0.8, { shoreAudit: () => ({ dryPoints: 9000, violations: 30, maxExcessM: 0.4, meanExcessM: 0.2 }) });
      expect(failed(await createWaterLodSpikeTestAdapter(host).measure(READ_SCENARIO, makeContext(host.calls)))).toEqual([
        'no crescents with the baked read (noise off, weight on)',
      ]);
    });

    it('fails when the baked frame differs from the analytic frame', async () => {
      const host = readHost({ diff: 40, share: 0.02 });
      expect(failed(await createWaterLodSpikeTestAdapter(host).measure(READ_SCENARIO, makeContext(host.calls)))).toEqual([
        'same picture: under 0.5 % of pixels differ by over 24 levels',
      ]);
      const shifted = readHost({ diff: 3, share: 1 });
      expect(failed(await createWaterLodSpikeTestAdapter(shifted).measure(READ_SCENARIO, makeContext(shifted.calls)))).toEqual([
        'same picture: mean luminance within 1.5 levels',
      ]);
    });

    it('fails when the baked read costs much more GPU time, or no time can be measured', async () => {
      const slow = readHost({}, 1.2);
      expect(failed(await createWaterLodSpikeTestAdapter(slow).measure(READ_SCENARIO, makeContext(slow.calls)))).toEqual([
        'the baked read costs at most 25 % more GPU time',
      ]);
      const blind = readHost({}, 0.8, { gpuFrameMs: () => null });
      expect(failed(await createWaterLodSpikeTestAdapter(blind).measure(READ_SCENARIO, makeContext(blind.calls)))).toEqual([
        'GPU time measured for both reads',
        'the baked read costs at most 25 % more GPU time',
      ]);
    });

    it('puts the page back afterwards and is in the suite history', async () => {
      const baked: (boolean | null)[] = [];
      const host = makeHost({ setBakedTerrain: (enabled) => baked.push(enabled) });
      const adapter = createWaterLodSpikeTestAdapter(host);
      const context = makeContext(host.calls);
      const snapshot = await adapter.capture(context);
      await adapter.restore(snapshot, context);

      expect(baked).toEqual([null]);
      const suite = WATER_LOD_SPIKE_TEST_HISTORY.find((entry) => entry.id === 'water-lod-spike-terrain-read');
      expect(suite?.version).toBe(1);
      expect(suite?.scenarios.map((scenario) => scenario.settings.measure)).toEqual(['terrain-read']);
      const second = WATER_LOD_SPIKE_TEST_HISTORY.filter((entry) => entry.id === 'water-lod-spike-terrain-read').find((entry) => entry.version === 2);
      expect(second?.scenarios.map((scenario) => scenario.settings.pixelRatio)).toEqual([3]);
      expect(suite?.scenarios.map((scenario) => scenario.settings.pixelRatio)).toEqual([undefined]);
    });
  });

  it('fails the shimmer gate when the filter changes nothing', async () => {
    const host = makeHost();
    host.setFilter = () => undefined;
    const aliased = makeHost();
    aliased.setFilter(false);
    host.readFrame = (x, y) => aliased.readFrame(x, y);
    const adapter = createWaterLodSpikeTestAdapter(host);

    const observation = await adapter.measure(ALIASING_SCENARIO, makeContext(host.calls));

    expect(observation.checks?.find((check) => check.name.startsWith('Q3 shimmer'))?.passed).toBe(false);
  });
});
