import { describeRendererGpu, type TestMetric, type TestRunAdapter, type TestScenario, type TestSuite } from 'triangular-engine/testing';
import { BLOCK_SAMPLES } from './block-grid';
import { ColliderBlockWorkerPool, meshDensityBlockInWorker, sampleDensityBlockInWorker } from './block-worker-pool';
import { DIRECTIONS, MODES, RADIUS_M, cpuGrid, surfaceBlock } from './block-fixtures';
import type { GpuDensityBlockGenerator } from './gpu-density-block';
import { meshDensityBlock } from './surface-nets';
import { unitM } from '../planet-shape-field';

/**
 * Plan 055 D2 on real hardware: the same block paths the specs time, as a performance suite for the test panel.
 * `gpu` is compute plus readback; `cpu-workers` is the CPU twin in a worker pool; `meshing` is surface nets.
 */
export interface ColliderBlocksTestSettings {
  readonly path: 'gpu' | 'cpu-workers' | 'meshing';
  readonly mode: 'wild' | 'hills' | 'blend';
  /** Blocks timed one at a time (latency). */
  readonly latencyBlocks: number;
  /** Blocks per pipelined burst, and bursts timed (throughput). */
  readonly burstBlocks: number;
  readonly bursts: number;
}

export interface ColliderBlocksHost {
  generator(): GpuDensityBlockGenerator | null;
  pool(): ColliderBlockWorkerPool;
}

const MODE_INDEX = { wild: 0, hills: 1, blend: 2 } as const;

function scenario(path: ColliderBlocksTestSettings['path'], mode: ColliderBlocksTestSettings['mode']): TestScenario<ColliderBlocksTestSettings> {
  const label = path === 'meshing'
    ? 'Surface nets, main thread and worker'
    : `${path === 'gpu' ? 'GPU compute + readback' : 'CPU twin in workers'}, ${MODES[MODE_INDEX[mode]].name}`;
  return {
    id: path === 'meshing' ? 'meshing' : `${path}-${mode}`, label, durationMs: 2000, warmupMs: 0,
    settings: { path, mode, latencyBlocks: 24, burstBlocks: path === 'gpu' ? 64 : 16, bursts: 3 },
  };
}

export const COLLIDER_BLOCKS_TEST_HISTORY: readonly TestSuite<ColliderBlocksTestSettings>[] = [{
  id: 'collider-blocks',
  version: 1,
  title: 'Collider blocks: GPU density vs CPU workers (plan 055 D2)',
  purpose: 'performance',
  expectedGpuVendor: 'nvidia',
  scenarios: [
    ...(['wild', 'hills', 'blend'] as const).map((mode) => scenario('gpu', mode)),
    ...(['wild', 'hills', 'blend'] as const).map((mode) => scenario('cpu-workers', mode)),
    scenario('meshing', 'wild'),
  ],
}];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function specsFor(mode: ColliderBlocksTestSettings['mode']) {
  const m = MODES[MODE_INDEX[mode]];
  return DIRECTIONS.map((d) => ({ ...surfaceBlock(d), biomeOverride: m.biomeOverride, groundedOverride: m.groundedOverride }));
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
};

const metric = (name: string, unit: string, source: string, samples: number[]): TestMetric => ({ name, unit, source, samples });

export function createColliderBlocksTestAdapter(host: ColliderBlocksHost): TestRunAdapter<ColliderBlocksTestSettings, null> {
  const gpuRun = async (settings: ColliderBlocksTestSettings, signal: AbortSignal) => {
    const generator = host.generator();
    if (!generator) throw new Error('WebGPU is not available on this page');
    const specs = specsFor(settings.mode);
    let frame = 1;
    const one = async (id: number, spec: (typeof specs)[number]) => {
      if (!generator.request(id, spec, frame)) throw new Error('readback ring full');
      for (;;) {
        throwIfAborted(signal);
        const [result] = generator.poll(++frame);
        if (result) return result;
        await sleep(0);
      }
    };
    for (let i = 0; i < 4; i++) await one(i, specs[i % specs.length]); // pipeline compile and warm-up
    const first = await one(0, specs[0]);
    const reference = cpuGrid(specs[0]);
    let worst = 0;
    for (let i = 0; i < BLOCK_SAMPLES; i++) worst = Math.max(worst, Math.abs(first.grid[i] - reference[i]));
    const latency: number[] = [];
    for (let i = 0; i < settings.latencyBlocks; i++) latency.push((await one(i, specs[i % specs.length])).roundTripMs);
    const perBlock: number[] = [];
    for (let b = 0; b < settings.bursts; b++) {
      let sent = 0;
      let got = 0;
      const t0 = performance.now();
      while (got < settings.burstBlocks) {
        throwIfAborted(signal);
        while (sent < settings.burstBlocks && generator.request(sent, specs[sent % specs.length], ++frame)) sent++;
        got += generator.poll(++frame).length;
        await sleep(0);
      }
      perBlock.push((performance.now() - t0) / settings.burstBlocks);
    }
    return { latency, perBlock, worst };
  };

  const cpuRun = async (settings: ColliderBlocksTestSettings, signal: AbortSignal) => {
    const pool = host.pool();
    const specs = specsFor(settings.mode);
    // Module load and JIT warm-up in every worker.
    await Promise.all(Array.from({ length: pool.size * 2 }, (_, i) => sampleDensityBlockInWorker(pool, specs[i % specs.length])));
    const latency: number[] = [];
    for (let i = 0; i < settings.latencyBlocks; i++) {
      throwIfAborted(signal);
      latency.push((await sampleDensityBlockInWorker(pool, specs[i % specs.length])).timing.roundTripMs);
    }
    const perBlock: number[] = [];
    const burst = pool.size * Math.max(1, Math.round(settings.burstBlocks / pool.size));
    for (let b = 0; b < settings.bursts; b++) {
      throwIfAborted(signal);
      const t0 = performance.now();
      await Promise.all(Array.from({ length: burst }, (_, i) => sampleDensityBlockInWorker(pool, specs[i % specs.length])));
      perBlock.push((performance.now() - t0) / burst);
    }
    return { latency, perBlock, workers: pool.size };
  };

  return {
    capture: () => null,
    apply: () => undefined,
    ready: () => Promise.resolve(),
    restore: () => undefined,
    environment() {
      const generator = host.generator();
      return {
        ...describeRendererGpu(generator?.renderer as never),
        'bench.bodyRadiusM': RADIUS_M,
        'bench.unitM': unitM(RADIUS_M),
        'bench.hardwareConcurrency': navigator.hardwareConcurrency,
        'bench.workers': host.pool().size,
      };
    },
    async measure(scenarioToRun, context) {
      const s = scenarioToRun.settings;
      if (s.path === 'gpu') {
        const r = await gpuRun(s, context.signal);
        return {
          metrics: [
            metric('block latency', 'ms', 'compute submit on the CPU + ReadbackRing latency, one block in flight', r.latency),
            metric('block throughput', 'ms/block', 'wall time per block with the readback ring full', r.perBlock),
          ],
          checks: [{ name: 'GPU block matches the CPU twin', passed: r.worst < unitM(RADIUS_M) * 0.01, detail: `worst ${r.worst.toExponential(2)} m` }],
        };
      }
      if (s.path === 'cpu-workers') {
        const r = await cpuRun(s, context.signal);
        return {
          metrics: [
            metric('block latency', 'ms', 'worker round trip, one block in flight', r.latency),
            metric('block throughput', 'ms/block', `wall time per block, ${r.workers} workers busy`, r.perBlock),
          ],
          checks: [{ name: 'workers ran', passed: r.latency.length > 0 }],
        };
      }
      const spec = specsFor('wild')[1];
      const grid = cpuGrid(spec);
      const main: number[] = [];
      const worker: number[] = [];
      let triangles = 0;
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        triangles = meshDensityBlock(grid, spec.voxelM).indices.length / 3;
        main.push(performance.now() - t);
      }
      for (let i = 0; i < 10; i++) {
        throwIfAborted(context.signal);
        worker.push((await meshDensityBlockInWorker(host.pool(), Float32Array.from(grid), spec.voxelM)).timing.roundTripMs);
      }
      return {
        metrics: [
          metric('mesh main thread', 'ms', 'surface nets, one block', main),
          metric('mesh worker round trip', 'ms', 'transfer in, surface nets, transfer out', worker),
        ],
        checks: [{ name: 'mesh has triangles', passed: triangles > 100, detail: `${triangles} triangles` }],
      };
    },
  };
}
