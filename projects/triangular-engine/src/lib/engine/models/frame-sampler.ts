import { GPU_PASS_KINDS, timestampResolution } from './gpu-pass-timing';
import type { GpuPassKind, GpuTimestampBatch, TimestampResolution } from './gpu-pass-timing';

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
  /**
   * GPU time split by render pass, from the same timestamp readbacks as `gpuMedianMs`. `null` when no batch
   * was resolved in the window, or the renderer exposes no per-pass timestamps.
   */
  readonly gpuPasses?: IGpuPassSummary | null;
}

/** One per-frame series of GPU ms: a pass kind, a pass label or the frame total. */
export interface IGpuPassStat {
  /** Frames that had this pass. */
  readonly count: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  /** Per-frame ms in render order. */
  readonly samples: readonly number[];
}

/**
 * Checks that the per-pass numbers can be trusted. `passed` is true only with no `issues`:
 * - every timestamp in a batch belongs to a pass the renderer began (`unattributedPasses`);
 * - every pass the renderer began has a timestamp, so no frame is cut short (`incompleteFrames`);
 * - no batch repeats frames already counted (`staleFrames`);
 * - the passes of a batch's last frame add up to the total Three.js reports for it (`totalMismatches`);
 * - timestamps are not rounded (`resolution.quantized`) and enough durations were seen to tell.
 */
export interface IGpuTimerSelfTest {
  readonly passed: boolean;
  readonly issues: readonly string[];
  readonly batches: number;
  readonly unattributedPasses: number;
  readonly incompleteFrames: number;
  readonly staleFrames: number;
  readonly totalMismatches: number;
}

export interface IGpuPassSummary {
  /** Complete frames attributed in the window. */
  readonly frames: number;
  readonly total: IGpuPassStat;
  readonly byKind: Readonly<Partial<Record<GpuPassKind, IGpuPassStat>>>;
  readonly byLabel: Readonly<Record<string, IGpuPassStat>>;
  readonly resolution: TimestampResolution;
  readonly selfTest: IGpuTimerSelfTest;
}

/** What one resolved readback adds to a window: the attributed batch and its checks. */
export interface IGpuPassBatchRecord {
  readonly batch: GpuTimestampBatch;
  /** `false` when the batch's last frame did not add up to the Three.js total; `null` when it was not compared. */
  readonly totalMatches: boolean | null;
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

function passStat(samples: readonly number[]): IGpuPassStat {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), samples };
}

/** Reduces the per-pass readbacks of one window to per-kind and per-label series and the timer self-test. */
export function summarizeGpuPasses(records: readonly IGpuPassBatchRecord[]): IGpuPassSummary | null {
  if (!records.length) return null;
  const total: number[] = [];
  const byKind = new Map<GpuPassKind, number[]>();
  const byLabel = new Map<string, number[]>();
  const durations: number[] = [];
  let unattributedPasses = 0;
  let incompleteFrames = 0;
  let staleFrames = 0;
  let totalMismatches = 0;
  for (const { batch, totalMatches } of records) {
    unattributedPasses += batch.unattributedPasses;
    incompleteFrames += batch.incompleteFrames;
    staleFrames += batch.staleFrames;
    if (totalMatches === false) totalMismatches++;
    durations.push(...batch.passDurationsMs);
    for (const frame of batch.frames) {
      total.push(frame.totalMs);
      for (const [kind, ms] of Object.entries(frame.byKind) as [GpuPassKind, number][]) {
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind)!.push(ms);
      }
      for (const [label, ms] of Object.entries(frame.byLabel)) {
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label)!.push(ms);
      }
    }
  }
  const resolution = timestampResolution(durations);
  const issues: string[] = [];
  if (!total.length) issues.push('No complete frame was attributed');
  if (unattributedPasses) issues.push(`${unattributedPasses} timestamp(s) belong to no recorded pass`);
  if (incompleteFrames) issues.push(`${incompleteFrames} frame(s) were missing a pass timestamp`);
  if (staleFrames) issues.push(`${staleFrames} frame(s) were resolved twice (stale readback)`);
  if (totalMismatches) issues.push(`${totalMismatches} batch(es) did not add up to the Three.js frame total`);
  if (resolution.resolutionNs === null) issues.push(`Only ${resolution.samples} nonzero pass duration(s): too few to check timestamp rounding`);
  else if (resolution.quantized) {
    issues.push(`Timestamps are rounded to ${resolution.resolutionNs} ns: enable chrome://flags/#enable-webgpu-developer-features`);
  }
  const kinds: Partial<Record<GpuPassKind, IGpuPassStat>> = {};
  for (const kind of GPU_PASS_KINDS) {
    const samples = byKind.get(kind);
    if (samples) kinds[kind] = passStat(samples);
  }
  return {
    frames: total.length,
    total: passStat(total),
    byKind: kinds,
    byLabel: Object.fromEntries([...byLabel].map(([label, samples]) => [label, passStat(samples)])),
    resolution,
    selfTest: {
      passed: issues.length === 0, issues, batches: records.length,
      unattributedPasses, incompleteFrames, staleFrames, totalMismatches,
    },
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
  private gpuPasses: IGpuPassBatchRecord[] = [];

  get isActive(): boolean {
    return this.active;
  }

  /** Whole-render GPU ms of the open window so far, one per resolved readback (read-only; for a settle check). */
  get gpuSamples(): readonly number[] {
    return this.gpu;
  }

  start(): void {
    this.active = true;
    this.cpu = [];
    this.wall = [];
    this.gpu = [];
    this.invalid = [];
    this.gpuPasses = [];
  }

  /** Ends the window and returns its summary. */
  stop(): IFrameSampleSummary {
    this.active = false;
    return { ...summarizeFrameSamples(this.cpu, this.wall, this.gpu, this.invalid), gpuPasses: summarizeGpuPasses(this.gpuPasses) };
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

  /** One resolved readback split by pass (fed by the engine when `gpuTiming` is on). */
  recordGpuPasses(record: IGpuPassBatchRecord): void {
    if (this.active) this.gpuPasses.push(record);
  }
}
