/**
 * Summary of one `FrameSampler` window. Medians and p95s are over the frames in the window.
 *
 * `verdict`: `inconclusive` when the window has too few frames to trust; `noisy` when the CPU time
 * spreads more than 15 % above its median (p95 vs median), so a single comparison is not reliable;
 * otherwise `ok`.
 */
export interface IFrameSampleSummary {
  readonly frames: number;
  /** Tick + render CPU time per frame. Not quantized by the display refresh rate. */
  readonly cpuMedianMs: number;
  readonly cpuP95Ms: number;
  /** Wall-clock interval between consecutive frames. Capped by the display refresh rate. */
  readonly wallMedianMs: number;
  readonly wallP95Ms: number;
  /** Median GPU frame time, or `null` when no GPU samples were resolved (`gpuTiming` off or unsupported). */
  readonly gpuMedianMs: number | null;
  readonly gpuSamples: number;
  readonly verdict: 'ok' | 'noisy' | 'inconclusive';
}

/** Below this many frames a window says nothing reliable. */
const MIN_FRAMES = 60;
/** CPU p95 above the median by more than this fraction marks the window as noisy. */
const NOISY_SPREAD = 0.15;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

/** Reduces raw per-frame samples to the medians, p95s and verdict of one window. */
export function summarizeFrameSamples(
  cpuMs: readonly number[],
  wallMs: readonly number[],
  gpuMs: readonly number[],
): IFrameSampleSummary {
  const cpu = [...cpuMs].sort((a, b) => a - b);
  const wall = [...wallMs].sort((a, b) => a - b);
  const gpu = [...gpuMs].sort((a, b) => a - b);
  const cpuMedianMs = percentile(cpu, 0.5);
  const cpuP95Ms = percentile(cpu, 0.95);
  const spread = cpuMedianMs > 0 ? (cpuP95Ms - cpuMedianMs) / cpuMedianMs : 0;

  let verdict: IFrameSampleSummary['verdict'] = 'ok';
  if (cpu.length < MIN_FRAMES) verdict = 'inconclusive';
  else if (spread > NOISY_SPREAD) verdict = 'noisy';

  return {
    frames: cpu.length,
    cpuMedianMs,
    cpuP95Ms,
    wallMedianMs: percentile(wall, 0.5),
    wallP95Ms: percentile(wall, 0.95),
    gpuMedianMs: gpu.length > 0 ? percentile(gpu, 0.5) : null,
    gpuSamples: gpu.length,
    verdict,
  };
}

/**
 * Records per-frame timing inside an explicit window (`start()` … `stop()`).
 *
 * Idle until `start()`: outside a window every call returns immediately, so leaving it wired into
 * the render loop costs nothing. Fed by `FPSController.recordFrame` and `recordGpuFrameTime`.
 */
export class FrameSampler {
  private active = false;
  private cpu: number[] = [];
  private wall: number[] = [];
  private gpu: number[] = [];

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.cpu = [];
    this.wall = [];
    this.gpu = [];
  }

  /** Ends the window and returns its summary. */
  stop(): IFrameSampleSummary {
    this.active = false;
    return summarizeFrameSamples(this.cpu, this.wall, this.gpu);
  }

  /**
   * @param cpuMs Tick + render time of this frame.
   * @param wallMs Interval since the previous frame, or a negative value when it is unknown
   *   (first frame, or a tab-suspend gap).
   */
  recordFrame(cpuMs: number, wallMs: number): void {
    if (!this.active) return;
    this.cpu.push(cpuMs);
    if (wallMs >= 0) this.wall.push(wallMs);
  }

  recordGpu(gpuMs: number): void {
    if (this.active) this.gpu.push(gpuMs);
  }
}
