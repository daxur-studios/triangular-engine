/**
 * Summary of one `FrameSampler` window. Medians and p95s are over the frames in the window.
 *
 * `verdict`: `inconclusive` when the window has too few frames, or any validity reason was recorded
 * (`invalidReasons`); `noisy` when the CPU time spreads more than 15 % above its median (p95 vs
 * median; any p95 above a zero median counts as noisy), so one comparison is not reliable; otherwise `ok`.
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
  /** Why this window cannot be trusted (hidden tab, lost focus, throttled cadence, ...). Empty when valid. */
  readonly invalidReasons: readonly string[];
  readonly verdict: 'ok' | 'noisy' | 'inconclusive';
}

/** Below this many frames a window says nothing reliable. */
const MIN_FRAMES = 60;
/** CPU p95 above the median by more than this fraction marks the window as noisy. */
const NOISY_SPREAD = 0.15;
/**
 * A median frame interval above this means the page was throttled (hidden, background, or
 * starved), not that the scene is slow: 20 fps is the floor for a valid measurement.
 */
const MAX_VALID_MEDIAN_WALL_MS = 50;

/**
 * Nearest-rank percentile on a sorted array: the value at rank ceil(p * n). The median is the
 * average of the two middle values for an even count, so `[2, 4]` gives 3.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p === 0.5 && sorted.length % 2 === 0) {
    const upper = sorted.length / 2;
    return (sorted[upper - 1] + sorted[upper]) / 2;
  }
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Reduces raw per-frame samples to the medians, p95s, validity and verdict of one window. */
export function summarizeFrameSamples(
  cpuMs: readonly number[],
  wallMs: readonly number[],
  gpuMs: readonly number[],
  invalidReasons: readonly string[] = [],
): IFrameSampleSummary {
  const cpu = [...cpuMs].sort((a, b) => a - b);
  const wall = [...wallMs].sort((a, b) => a - b);
  const gpu = [...gpuMs].sort((a, b) => a - b);
  const cpuMedianMs = percentile(cpu, 0.5);
  const cpuP95Ms = percentile(cpu, 0.95);
  const wallMedianMs = percentile(wall, 0.5);
  // A zero median has no relative spread, so any tail above it is treated as noise.
  const spread = cpuMedianMs > 0 ? (cpuP95Ms - cpuMedianMs) / cpuMedianMs : cpuP95Ms > 0 ? Infinity : 0;

  const reasons = [...invalidReasons];
  if (wallMedianMs > MAX_VALID_MEDIAN_WALL_MS) reasons.push(`cadence ${wallMedianMs.toFixed(0)} ms median`);

  let verdict: IFrameSampleSummary['verdict'] = 'ok';
  if (cpu.length < MIN_FRAMES || reasons.length > 0) verdict = 'inconclusive';
  else if (spread > NOISY_SPREAD) verdict = 'noisy';

  return {
    frames: cpu.length,
    cpuMedianMs,
    cpuP95Ms,
    wallMedianMs,
    wallP95Ms: percentile(wall, 0.95),
    gpuMedianMs: gpu.length > 0 ? percentile(gpu, 0.5) : null,
    gpuSamples: gpu.length,
    invalidReasons: reasons,
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
  private invalid: string[] = [];

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.cpu = [];
    this.wall = [];
    this.gpu = [];
    this.invalid = [];
  }

  /** Ends the window and returns its summary. */
  stop(): IFrameSampleSummary {
    this.active = false;
    return summarizeFrameSamples(this.cpu, this.wall, this.gpu, this.invalid);
  }

  /**
   * Marks the open window as untrustworthy (for example the tab was hidden or lost focus). The
   * reason is kept once; the summary then reports `inconclusive`.
   */
  invalidate(reason: string): void {
    if (this.active && !this.invalid.includes(reason)) this.invalid.push(reason);
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
