/**
 * Plan 050 Phase 5: one-button frame-time benchmark for a demo page.
 *
 * A page lists scenarios (each one sets its own state), and `runFrameBenchmark` applies them one by one,
 * waits for streaming to settle, samples frame times, and returns a markdown report that can be pasted back.
 * Frame times are `requestAnimationFrame` deltas, so they are capped by the display refresh rate: a scenario
 * at the refresh rate says "not slower than that", it does not say how much headroom there is.
 */
import type { FrameSampler, IFrameSampleSummary } from 'triangular-engine';

export interface IBenchmarkScenario {
  readonly name: string;
  /** Applies the scenario (set signals, toggle batching, ...). May return a promise. */
  readonly apply: () => void | Promise<void>;
}

export interface IBenchmarkSample {
  readonly name: string;
  readonly frames: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly fps: number;
  /** FrameSampler CPU median (tick + render), not capped by the display. `null` without a sampler. */
  readonly cpuMedianMs: number | null;
  /** FrameSampler GPU median; `null` when `gpuTiming` is off or unsupported. */
  readonly gpuMedianMs: number | null;
  readonly verdict: IFrameSampleSummary['verdict'] | null;
  readonly extra: string;
}

export interface IBenchmarkOptions {
  readonly scenarios: readonly IBenchmarkScenario[];
  /**
   * Engine frame sampler (`fpsController.frameSampler`). Wrapped around each recorded scenario, it
   * adds the CPU and GPU medians and a verdict to the table. The rAF columns are unchanged.
   */
  readonly frameSampler?: FrameSampler;
  /** True once streaming is idle (nothing queued), so installs do not pollute the samples. */
  readonly isSettled: () => boolean;
  /** One short line per scenario (draw calls, triangles, ...), read after sampling. */
  readonly describe: () => string;
  /** Header lines for the report (backend, antialiasing, ...). */
  readonly header: () => string[];
  readonly sampleMs?: number;
  readonly warmupMs?: number;
  readonly maxSettleMs?: number;
  readonly onProgress?: (text: string) => void;
}

const nextFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

async function sampleFrames(durationMs: number): Promise<number[]> {
  const deltas: number[] = [];
  let last = await nextFrame();
  const end = last + durationMs;
  while (last < end) {
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
  }
  return deltas;
}

export async function runFrameBenchmark(
  options: IBenchmarkOptions,
): Promise<{ samples: IBenchmarkSample[]; report: string }> {
  const sampleMs = options.sampleMs ?? 3000;
  const warmupMs = options.warmupMs ?? 800;
  const maxSettleMs = options.maxSettleMs ?? 8000;
  const samples: IBenchmarkSample[] = [];
  const started = performance.now();

  // The first scenario runs once more, unrecorded: shader compiles and the first tile installs land there.
  const plan = options.scenarios.length > 0 ? [options.scenarios[0], ...options.scenarios] : [];
  for (const [planIndex, scenario] of plan.entries()) {
    const index = planIndex - 1;
    const isWarmup = planIndex === 0;
    options.onProgress?.(
      isWarmup ? 'warm-up' : `${index + 1}/${options.scenarios.length} ${scenario.name}`,
    );
    await scenario.apply();
    // Let signal effects and a recreated view run, then wait for streaming to go idle.
    await sleep(200);
    const settleStart = performance.now();
    while (performance.now() - settleStart < maxSettleMs) {
      await sleep(250);
      if (options.isSettled()) break;
    }
    await sleep(warmupMs);
    if (!isWarmup) options.frameSampler?.start();
    const deltas = await sampleFrames(isWarmup ? 1500 : sampleMs);
    const frameWindow = isWarmup ? undefined : options.frameSampler?.stop();
    if (isWarmup) continue;
    const sorted = [...deltas].sort((a, b) => a - b);
    const mean = deltas.reduce((sum, v) => sum + v, 0) / Math.max(1, deltas.length);
    samples.push({
      name: scenario.name,
      frames: deltas.length,
      meanMs: mean,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      worstMs: sorted[sorted.length - 1] ?? 0,
      fps: mean > 0 ? 1000 / mean : 0,
      cpuMedianMs: frameWindow ? frameWindow.cpuMedianMs : null,
      gpuMedianMs: frameWindow?.gpuMedianMs ?? null,
      verdict: frameWindow ? frameWindow.verdict : null,
      extra: options.describe(),
    });
  }

  const f = (v: number) => v.toFixed(1);
  const sampled = options.frameSampler !== undefined;
  const lines = [
    '### Frame benchmark',
    ...options.header().map((line) => `- ${line}`),
    `- total run: ${((performance.now() - started) / 1000).toFixed(0)} s, ${sampleMs / 1000} s sampled per scenario`,
    ...(sampled
      ? ['- rAF columns (mean..fps) are capped by the display refresh rate. cpu/gpu medians come from FrameSampler; gpu needs gpuTiming on. verdict noisy means the CPU spread is above 15 %: read the medians, not the verdict, when it says noisy.']
      : []),
    '',
    ...(samples.some((s) => s.fps < 5)
      ? ['- WARNING: rows under 5 fps mean the tab was throttled (hidden or unfocused) or still compiling. Keep it visible and rerun.']
      : []),
    '',
    '| scenario | frames | mean ms | p50 | p95 | worst | fps | cpu med | gpu med | verdict | notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...samples.map(
      (s) =>
        `| ${s.name} | ${s.frames} | ${f(s.meanMs)} | ${f(s.p50Ms)} | ${f(s.p95Ms)} | ${f(s.worstMs)} | ${f(s.fps)} | ${s.cpuMedianMs === null ? '-' : s.cpuMedianMs.toFixed(2)} | ${s.gpuMedianMs === null ? 'n/a' : s.gpuMedianMs.toFixed(2)} | ${s.verdict ?? '-'} | ${s.extra} |`,
    ),
  ];
  return { samples, report: lines.join('\n') };
}
