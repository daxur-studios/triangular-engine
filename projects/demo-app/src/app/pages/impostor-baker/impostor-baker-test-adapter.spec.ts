import type { TestContext, TestSetting } from 'triangular-engine/testing';
import {
  createImpostorBakerTestAdapter,
  type ImpostorBakerTestHost,
} from './impostor-baker-test-adapter';
import {
  IMPOSTOR_BAKER_TEST_HISTORY,
  type ImpostorBakerTestSettings,
} from './impostor-baker-tests';

const settings: ImpostorBakerTestSettings = {
  operation: 'check',
  species: 'oak',
  seed: 7,
  type: 'hemispherical',
  spritesPerSide: 8,
  textureSizePx: 512,
  forestCount: 500,
  rebuildSourceTree: false,
  compressionFormat: 'image/webp',
  compressionQuality: 0.8,
  normalDepthMode: 'lossless',
};

function makeHost(): ImpostorBakerTestHost & {
  applied: ImpostorBakerTestSettings[];
  frames: Array<() => void>;
} {
  const applied: ImpostorBakerTestSettings[] = [];
  const frames: Array<() => void> = [];
  const host = {
    engine: {
      renderer: {},
      beforeRender$: {
        subscribe(next: () => void) {
          frames.push(next);
          return {
            unsubscribe: () => {
              const index = frames.indexOf(next);
              if (index >= 0) frames.splice(index, 1);
            },
          };
        },
      },
      renderComplete$: {
        subscribe() {
          return { unsubscribe: () => undefined };
        },
      },
    },
    applied,
    frames,
    readTestSettings: () => settings,
    applyTestSettings: (value: ImpostorBakerTestSettings) => {
      host.applied.push(value);
    },
    waitForTestReady: async () => undefined,
    measureTestBake: () => ({
      sourceTreeBuildMs: 0.5,
      cleanupMs: 0.1,
      updateSourceMs: 0.2,
      atlasBakeMs: 4,
      impostorBuildMs: 0.3,
      previewBuildMs: 0.4,
      forestBuildMs: 0.6,
      totalMs: 5.7,
    }),
    measureTestCompression: async () => ({
      wallMs: 12,
      durationMs: 11,
      rawGpuSizeBytes: 1000,
      totalRawPngSizeBytes: 900,
      totalCompressedSizeBytes: 450,
      pngSavingsPercent: 50,
    }),
    inspectTestState: () => [{ name: 'state valid', passed: true }],
    readTestRenderInfo: () => ({ drawCalls: 1, triangles: 12 }),
    testEnvironment: (): Readonly<Record<string, TestSetting>> => ({
      'gpu.backend': 'test',
    }),
  };
  return host;
}

function makeContext(signal = new AbortController().signal): TestContext {
  return {
    signal,
    profile: 'human-observed',
    mode: 'standard',
    repetition: 1,
    wait: async () => {
      /* frame callbacks below stand in for engine renders */
    },
    measureWindow: async () => ({
      mode: 'standard',
      elapsedMs: 0,
      stoppedBy: 'fixed',
    }),
  };
}

describe('Impostor Baker reusable test integration', () => {
  it('keeps functional and performance suites as separate history entries', () => {
    expect(
      IMPOSTOR_BAKER_TEST_HISTORY.map((suite) => [suite.id, suite.purpose]),
    ).toEqual([
      ['impostor-baker-functional', 'functional'],
      ['impostor-baker-cost', 'performance'],
    ]);
    expect(IMPOSTOR_BAKER_TEST_HISTORY[0].requiresVisualReview).toBeTrue();
  });

  it('returns the host checks for a functional scenario', async () => {
    const host = makeHost();
    const adapter = createImpostorBakerTestAdapter(host);
    await adapter.apply(
      IMPOSTOR_BAKER_TEST_HISTORY[0].scenarios[0],
      makeContext(),
    );
    const result = await adapter.measure(
      IMPOSTOR_BAKER_TEST_HISTORY[0].scenarios[0],
      makeContext(),
    );
    expect(host.applied[0].operation).toBe('check');
    expect(result.checks).toEqual([{ name: 'state valid', passed: true }]);
  });

  it('reports separately attributed bake stages and identifies GPU timing as unavailable', async () => {
    const host = makeHost();
    const adapter = createImpostorBakerTestAdapter(host);
    const scenario = IMPOSTOR_BAKER_TEST_HISTORY[1].scenarios[0];
    const result = await adapter.measure(scenario, makeContext());
    expect(result.metrics.map((metric) => metric.name)).toContain(
      'atlasBakeMs',
    );
    expect(
      result.metrics.find((metric) => metric.name === 'gpuAtlasMs'),
    ).toEqual(
      jasmine.objectContaining({
        optional: true,
        samples: [],
        unavailableReason: jasmine.any(String),
      }),
    );
  });

  it('restores captured settings after a run and removes its rendered-frame listener', async () => {
    const host = makeHost();
    const adapter = createImpostorBakerTestAdapter(host);
    await adapter.restore(settings, {
      ...makeContext(),
      wait: async () => {
        host.frames.slice().forEach((frame) => frame());
      },
    });
    expect(host.applied).toEqual([
      { ...settings, operation: 'check', rebuildSourceTree: false },
    ]);
    expect(host.frames).toHaveSize(0);
  });
});
