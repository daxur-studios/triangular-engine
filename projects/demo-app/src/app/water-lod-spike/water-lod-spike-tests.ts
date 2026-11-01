import { simpleAdapter, type TestObservation, type TestRunAdapter, type TestSetting, type TestSuite } from 'triangular-engine/testing';

/** Settings a W0b case applies: the spike's own material wireframe. */
export interface WaterLodSpikeTestSettings {
  readonly wireframe: boolean;
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
  environment(): Readonly<Record<string, TestSetting>>;
}

const WATER_LOD_SPIKE_V1: TestSuite<WaterLodSpikeTestSettings> = {
  id: 'water-lod-spike',
  version: 1,
  title: 'Water LOD spike W0b: water body draws, wireframe applies',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    {
      id: 'solid',
      label: 'Solid water',
      settings: { wireframe: false },
      durationMs: 3000,
      warmupMs: 1000,
    },
    {
      id: 'wireframe',
      label: 'Wireframe water',
      settings: { wireframe: true },
      durationMs: 3000,
      warmupMs: 1000,
    },
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
    {
      id: 'solid',
      label: 'Solid water',
      settings: { wireframe: false },
      durationMs: 6000,
      warmupMs: 1500,
    },
    {
      id: 'wireframe',
      label: 'Wireframe water',
      settings: { wireframe: true },
      durationMs: 6000,
      warmupMs: 1500,
    },
  ],
};

/** Every version of the W0b suites, oldest first. Add a new entry when a case changes; keep old ones. */
export const WATER_LOD_SPIKE_TEST_HISTORY: readonly TestSuite<WaterLodSpikeTestSettings>[] = [
  WATER_LOD_SPIKE_V1,
  WATER_LOD_SPIKE_PERFORMANCE_V1,
];

/**
 * Testing adapter for the W0b page. Applies the wireframe setting to the spike's
 * own material (never `<scene>`'s `[wireframe]`), waits for the water body to
 * draw, then records draw calls and triangles with checks on what the page shows.
 */
export function createWaterLodSpikeTestAdapter(host: WaterLodSpikeTestHost): TestRunAdapter<WaterLodSpikeTestSettings, boolean> {
  return simpleAdapter<WaterLodSpikeTestSettings, boolean>({
    windowModes: false,
    capture: () => host.wireframe(),
    apply: (scenario) => host.setWireframe(scenario.settings.wireframe),
    restore: (wireframe) => host.setWireframe(wireframe),
    ready: async (context) => {
      while (!host.ready()) {
        await context.wait(100);
      }
    },
    environment: () => host.environment(),
    measure: async (scenario, context): Promise<TestObservation> => {
      host.beginFrameSampling();
      await context.wait(scenario.durationMs);
      const frameMs = host.endFrameSampling();
      const { drawCalls, triangles } = host.counts();
      return {
        metrics: [
          { name: 'frame interval', unit: 'ms', source: 'engine.tick$ intervals', samples: [...frameMs] },
          { name: 'draw calls', unit: 'calls', source: 'renderer.info.render.calls', samples: [drawCalls] },
          { name: 'triangles', unit: 'triangles', source: 'renderer.info.render.triangles', samples: [triangles] },
        ],
        checks: [
          { name: 'water body draws', passed: drawCalls > 0, detail: `draw calls ${drawCalls}` },
          { name: 'triangles drawn', passed: triangles > 0, detail: `triangles ${triangles}` },
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
