import {
  waitRenderedFrames,
  type TestCheck,
  type TestContext,
  type TestMetric,
  type TestObservation,
  type TestRunAdapter,
  type TestScenario,
  type TestSetting,
} from 'triangular-engine/testing';
import type { ImpostorBakerTestSettings } from './impostor-baker-tests';

export interface ImpostorBakeTimings {
  readonly cleanupMs: number;
  readonly updateSourceMs: number;
  readonly atlasBakeMs: number;
  readonly impostorBuildMs: number;
  readonly previewBuildMs: number;
  readonly forestBuildMs: number;
  readonly totalMs: number;
}

export interface ImpostorCompressionStats {
  readonly wallMs: number;
  readonly durationMs: number;
  readonly rawGpuSizeBytes: number;
  readonly totalRawPngSizeBytes: number;
  readonly totalCompressedSizeBytes: number;
  readonly pngSavingsPercent: number;
}

interface FrameStream {
  subscribe(next: () => void): { unsubscribe(): void };
}

interface RenderCompleteStream {
  subscribe(next: (frame: { readonly renderedAt: number }) => void): {
    unsubscribe(): void;
  };
}

export interface ImpostorBakerTestHost {
  readonly engine: {
    readonly renderer: unknown;
    readonly beforeRender$: FrameStream;
    readonly renderComplete$: RenderCompleteStream;
  };
  readTestSettings(): ImpostorBakerTestSettings;
  applyTestSettings(settings: ImpostorBakerTestSettings): void;
  waitForTestReady(
    context: TestContext,
    expected: ImpostorBakerTestSettings,
  ): Promise<void>;
  measureTestBake(
    rebuildSourceTree: boolean,
  ): ImpostorBakeTimings & { readonly sourceTreeBuildMs: number };
  measureTestCompression(
    signal: AbortSignal,
  ): Promise<ImpostorCompressionStats>;
  inspectTestState(expected: ImpostorBakerTestSettings): readonly TestCheck[];
  readTestRenderInfo(): {
    readonly drawCalls: number;
    readonly triangles: number;
  };
  testEnvironment(): Readonly<Record<string, TestSetting>>;
}

const timeMetric = (
  name: string,
  source: string,
  value: number,
): TestMetric => ({
  name,
  unit: 'ms',
  source,
  samples: [value],
});

function bakeObservation(
  host: ImpostorBakerTestHost,
  settings: ImpostorBakerTestSettings,
): TestObservation {
  const timings = host.measureTestBake(settings.rebuildSourceTree);
  const viewCount = settings.spritesPerSide ** 2;
  const metrics: TestMetric[] = [
    timeMetric(
      'cleanupMs',
      'Main-thread wall time around disposal of the previous atlas, previews, material and forest.',
      timings.cleanupMs,
    ),
    timeMetric(
      'sourceUpdateMs',
      'Main-thread wall time updating the source tree world matrix before the atlas bake.',
      timings.updateSourceMs,
    ),
    timeMetric(
      'atlasBakeMs',
      `Main-thread wall time for createOctahedralImpostorAtlas, including ${viewCount} WebGL view renders and atlas setup/restoration; not GPU time.`,
      timings.atlasBakeMs,
    ),
    timeMetric(
      'impostorBuildMs',
      'Main-thread wall time for buildOctahedralImpostorMesh and material setup.',
      timings.impostorBuildMs,
    ),
    timeMetric(
      'previewBuildMs',
      'Main-thread wall time creating the albedo and normal/depth preview meshes.',
      timings.previewBuildMs,
    ),
    timeMetric(
      'forestBuildMs',
      `Main-thread wall time allocating and filling ${settings.forestCount} instance transforms.`,
      timings.forestBuildMs,
    ),
    timeMetric(
      'totalBakeMs',
      'Main-thread wall time for the measured full rebake, including all reported stages.',
      timings.totalMs,
    ),
  ];
  if (settings.rebuildSourceTree) {
    metrics.push(
      timeMetric(
        'sourceTreeBuildMs',
        'Main-thread wall time generating and colorizing the procedural source tree mesh.',
        timings.sourceTreeBuildMs,
      ),
    );
  }
  metrics.push({
    name: 'gpuAtlasMs',
    unit: 'ms',
    source: 'GPU timestamp query around atlas passes.',
    samples: [],
    optional: true,
    unavailableReason:
      'This page uses the WebGL atlas renderer, which does not expose a GPU timestamp provider for these bake calls.',
  });
  return {
    metrics,
    checks: host.inspectTestState(settings),
    details: {
      views: viewCount,
      atlasSizePx: settings.textureSizePx,
      forestCount: settings.forestCount,
    },
  };
}

function compressionObservation(
  stats: ImpostorCompressionStats,
): TestObservation {
  return {
    metrics: [
      timeMetric(
        'compressionWallMs',
        'Main-thread wall time around readback, image compression and texture creation.',
        stats.wallMs,
      ),
      timeMetric(
        'compressionApiMs',
        'durationMs reported by compressOctahedralImpostorAtlas.',
        stats.durationMs,
      ),
      {
        name: 'rawGpuSizeBytes',
        unit: 'bytes',
        source: 'Two uncompressed RGBA8 atlas attachments.',
        samples: [stats.rawGpuSizeBytes],
      },
      {
        name: 'totalRawPngSizeBytes',
        unit: 'bytes',
        source:
          'Encoded PNG size of both atlas attachments before compression.',
        samples: [stats.totalRawPngSizeBytes],
      },
      {
        name: 'totalCompressedSizeBytes',
        unit: 'bytes',
        source:
          'Encoded output size of both atlas attachments after compression.',
        samples: [stats.totalCompressedSizeBytes],
      },
      {
        name: 'pngSavingsPercent',
        unit: '%',
        source:
          'Compression API estimate of size savings against raw PNG output.',
        samples: [stats.pngSavingsPercent],
      },
    ],
    checks: [
      {
        name: 'Compressed textures were produced',
        passed: stats.totalCompressedSizeBytes > 0,
      },
    ],
  };
}

async function renderObservation(
  host: ImpostorBakerTestHost,
  scenario: TestScenario<ImpostorBakerTestSettings>,
  context: TestContext,
): Promise<TestObservation> {
  const frameIntervals: number[] = [];
  const submitTimes: number[] = [];
  const drawCalls: number[] = [];
  const triangles: number[] = [];
  let lastRenderedAt: number | undefined;
  let renderStartedAt: number | undefined;
  let completedFrames = 0;
  const beforeRender = host.engine.beforeRender$.subscribe(() => {
    renderStartedAt = performance.now();
  });
  const rendered = host.engine.renderComplete$.subscribe(({ renderedAt }) => {
    completedFrames++;
    if (lastRenderedAt !== undefined)
      frameIntervals.push(renderedAt - lastRenderedAt);
    if (renderStartedAt !== undefined)
      submitTimes.push(renderedAt - renderStartedAt);
    lastRenderedAt = renderedAt;
    const info = host.readTestRenderInfo();
    drawCalls.push(info.drawCalls);
    triangles.push(info.triangles);
  });
  const startedAt = performance.now();
  try {
    while (performance.now() - startedAt < scenario.durationMs) {
      context.signal.throwIfAborted();
      const remaining = scenario.durationMs - (performance.now() - startedAt);
      await context.wait(Math.min(100, Math.max(1, remaining)));
    }
  } finally {
    beforeRender.unsubscribe();
    rendered.unsubscribe();
  }

  const gpuUnavailable =
    'The page uses WebGL and has no GPU timestamp provider for this scene.';
  return {
    metrics: [
      {
        name: 'frameIntervalMs',
        unit: 'ms',
        source:
          'Deltas of EngineService.renderComplete$ timestamps; display-cadence quantized and not GPU time.',
        samples: frameIntervals,
        unavailableReason: frameIntervals.length
          ? undefined
          : 'Fewer than two frames completed in the window.',
      },
      {
        name: 'renderSubmitCpuMs',
        unit: 'ms',
        source:
          'Main-thread time from beforeRender$ to renderComplete$: scene command encoding and submit, not GPU execution.',
        samples: submitTimes,
        unavailableReason: submitTimes.length
          ? undefined
          : 'No complete render frame was observed.',
      },
      {
        name: 'drawCalls',
        unit: 'calls/frame',
        source:
          'Three.js renderer.info.render.calls read after each completed scene render.',
        samples: drawCalls,
      },
      {
        name: 'triangles',
        unit: 'triangles/frame',
        source:
          'Three.js renderer.info.render.triangles read after each completed scene render.',
        samples: triangles,
      },
      {
        name: 'gpuFrameMs',
        unit: 'ms',
        source: 'GPU timestamp query around the full scene frame.',
        samples: [],
        optional: true,
        unavailableReason: gpuUnavailable,
      },
    ],
    checks: [
      ...host.inspectTestState(scenario.settings),
      {
        name: 'At least 30 frames rendered',
        passed: completedFrames >= 30,
        detail: `${completedFrames} completed frames in ${scenario.durationMs} ms`,
      },
    ],
    details: {
      completedFrames,
      forestCount: scenario.settings.forestCount,
      durationMs: scenario.durationMs,
    },
  };
}

export function createImpostorBakerTestAdapter(
  host: ImpostorBakerTestHost,
): TestRunAdapter<ImpostorBakerTestSettings, ImpostorBakerTestSettings> {
  return {
    capture: () => host.readTestSettings(),
    apply: (scenario, context) => {
      context.signal.throwIfAborted();
      host.applyTestSettings(scenario.settings);
    },
    ready: (context, scenario) =>
      host.waitForTestReady(context, scenario.settings),
    measure: async (scenario, context) => {
      context.signal.throwIfAborted();
      if (scenario.settings.operation === 'check')
        return {
          checks: host.inspectTestState(scenario.settings),
          metrics: [],
        };
      if (scenario.settings.operation === 'compression') {
        const stats = await host.measureTestCompression(context.signal);
        context.signal.throwIfAborted();
        return compressionObservation(stats);
      }
      if (scenario.settings.operation === 'render') {
        return renderObservation(host, scenario, context);
      }
      const observation = bakeObservation(host, scenario.settings);
      context.signal.throwIfAborted();
      return observation;
    },
    restore: async (snapshot, context) => {
      host.applyTestSettings({
        ...snapshot,
        operation: 'check',
        rebuildSourceTree: false,
      });
      await waitRenderedFrames(host, context, 2);
    },
    environment: () => host.testEnvironment(),
  };
}
