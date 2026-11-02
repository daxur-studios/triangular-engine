import type { TestContext, TestScenario } from 'triangular-engine/testing';
import type { ILuminanceImage } from './core/water-lod-spike-image-metrics';
import {
  createWaterLodSpikeTestAdapter,
  type WaterLodSpikeTestHost,
  type WaterLodSpikeTestSettings,
} from './water-lod-spike-tests';

const WIDTH = 32;
const HEIGHT = 200;

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
    gpuFrameMs: () => 0.8,
    setView: (view) => calls.push(`setView:${view ? 'held' : 'free'}`),
    setFilter: (enabled) => {
      filter = enabled;
    },
    setTransfer: () => undefined,
    setPixelRatio: () => undefined,
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
