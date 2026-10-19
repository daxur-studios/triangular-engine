/**
 * Per-pass GPU timing for `IEngineOptions.gpuTiming`.
 *
 * Three.js `WebGPURenderer` writes one timestamp pair per render pass and keys it by a uid that ends in the
 * renderer frame (`r:<call>:<context>:f<frame>`). `resolveTimestampsAsync` returns only the last frame's total,
 * but leaves every pass of the resolved batch in the query pool's `timestamps` map. `GpuPassRecorder` learns
 * what each uid was (shadow map, scene, output transform, other full-screen pass) when the renderer begins it,
 * then splits a resolved batch into whole frames.
 *
 * WebGPU times passes, not objects: two meshes drawn in the same pass share one number. Separate an object's
 * cost by giving it its own pass or by an on/off ablation.
 */

/** What a render pass draws. `fullscreen` is any `QuadMesh` pass other than the renderer's output transform. */
export type GpuPassKind = 'scene' | 'shadow' | 'output' | 'fullscreen';

export const GPU_PASS_KINDS: readonly GpuPassKind[] = ['scene', 'shadow', 'output', 'fullscreen'];

export interface GpuPassInfo {
  readonly kind: GpuPassKind;
  /** The scene or quad name at the time of the pass (Three.js names shadow passes `Shadow Map [ <light> ]`). */
  readonly label: string;
}

/** The GPU time of one rendered frame, split by pass. */
export interface GpuFramePasses {
  /** `renderer.info.frame` of the frame. */
  readonly frame: number;
  readonly totalMs: number;
  /** Summed per kind; a kind with no pass this frame is absent. */
  readonly byKind: Readonly<Partial<Record<GpuPassKind, number>>>;
  /** Summed per pass label. */
  readonly byLabel: Readonly<Record<string, number>>;
  readonly passes: number;
}

/** One resolved timestamp batch, split into whole frames, plus what could not be attributed. */
export interface GpuTimestampBatch {
  /** Complete frames in render order. */
  readonly frames: readonly GpuFramePasses[];
  /** Every single pass duration of `frames`, for the rounding check. */
  readonly passDurationsMs: readonly number[];
  /** The last frame Three.js summed into its own total for this batch (`resolveTimestampsAsync`), or `null`. */
  readonly lastBatchFrame: number | null;
  /** Timestamps whose pass the recorder never saw. Their frame is dropped. */
  readonly unattributedPasses: number;
  /** Frames dropped because a pass the renderer began has no timestamp in the batch. */
  readonly incompleteFrames: number;
  /** Frames at or before the last attributed frame: a repeated batch (a failed readback keeps the old map). */
  readonly staleFrames: number;
}

interface SceneLike { readonly name?: string; readonly isQuadMesh?: boolean; readonly material?: { readonly name?: string } }
interface RenderTargetLike { readonly texture?: { readonly name?: string }; readonly depthTexture?: { readonly name?: string } | null }

const OUTPUT_QUAD_NAME = 'Output Color Transform';
const SHADOW_SCENE_PREFIX = 'Shadow Map [';
const FRAME_SUFFIX = /:f(\d+)$/;
/** Passes kept for frames not resolved yet. A readback normally covers a handful of frames. */
const MAX_PENDING_PASSES = 4096;

/** Names a pass from the arguments Three.js gives `inspector.beginRender(uid, scene, camera, renderTarget)`. */
export function classifyRenderPass(scene: SceneLike | null | undefined, renderTarget: RenderTargetLike | null | undefined): GpuPassInfo {
  const name = scene?.name ?? '';
  if (scene?.isQuadMesh) {
    if (name === OUTPUT_QUAD_NAME) return { kind: 'output', label: name };
    return { kind: 'fullscreen', label: name || scene.material?.name || 'fullscreen' };
  }
  if (name.startsWith(SHADOW_SCENE_PREFIX) || renderTarget?.texture?.name === 'ShadowMap' || renderTarget?.depthTexture?.name === 'ShadowDepthTexture') {
    return { kind: 'shadow', label: name || 'Shadow Map' };
  }
  return { kind: 'scene', label: name || 'scene' };
}

/** The renderer frame a timestamp uid belongs to, or `null` for a uid without a frame suffix. */
export function timestampUidFrame(uid: string): number | null {
  const match = FRAME_SUFFIX.exec(uid);
  return match ? Number(match[1]) : null;
}

/**
 * Remembers each pass the renderer begins and splits resolved timestamp batches into whole frames.
 * A frame is reported only when every pass the renderer began for it has a timestamp, so a readback that
 * lands mid-frame, or a pool that overflowed and reset, drops the frame instead of under-counting it.
 */
export class GpuPassRecorder {
  readonly #pending = new Map<string, GpuPassInfo & { readonly frame: number }>();
  #lastFrame = -1;

  /** Call from `inspector.beginRender`. */
  record(uid: string, scene: SceneLike | null | undefined, renderTarget: RenderTargetLike | null | undefined): void {
    const frame = timestampUidFrame(uid);
    if (frame === null) return;
    this.#pending.set(uid, { ...classifyRenderPass(scene, renderTarget), frame });
    if (this.#pending.size > MAX_PENDING_PASSES) this.#pending.delete(this.#pending.keys().next().value as string);
  }

  /** Splits one resolved batch (uid to ms, as the query pool's `timestamps` map holds it). */
  attribute(timestamps: ReadonlyMap<string, number>): GpuTimestampBatch {
    const frames = new Map<number, { passes: { info: GpuPassInfo; ms: number }[]; unknown: boolean }>();
    let unattributedPasses = 0;
    const stale = new Set<number>();
    for (const [uid, ms] of timestamps) {
      const frame = timestampUidFrame(uid);
      if (frame === null) { unattributedPasses++; continue; }
      if (frame <= this.#lastFrame) { stale.add(frame); continue; }
      let entry = frames.get(frame);
      if (!entry) frames.set(frame, (entry = { passes: [], unknown: false }));
      const info = this.#pending.get(uid);
      if (!info) { unattributedPasses++; entry.unknown = true; continue; }
      entry.passes.push({ info, ms });
    }
    const staleFrames = stale.size;

    const resolved = new Set(timestamps.keys());
    let incompleteFrames = 0;
    const out: GpuFramePasses[] = [];
    const passDurationsMs: number[] = [];
    for (const frame of [...frames.keys()].sort((a, b) => a - b)) {
      const entry = frames.get(frame)!;
      const missing = [...this.#pending].some(([uid, info]) => info.frame === frame && !resolved.has(uid));
      if (missing) incompleteFrames++;
      if (missing || entry.unknown) continue;
      const byKind: Partial<Record<GpuPassKind, number>> = {};
      const byLabel: Record<string, number> = {};
      let totalMs = 0;
      for (const { info, ms } of entry.passes) {
        byKind[info.kind] = (byKind[info.kind] ?? 0) + ms;
        byLabel[info.label] = (byLabel[info.label] ?? 0) + ms;
        totalMs += ms;
        passDurationsMs.push(ms);
      }
      out.push({ frame, totalMs, byKind, byLabel, passes: entry.passes.length });
    }

    const lastBatchFrame = frames.size ? Math.max(...frames.keys()) : null;
    if (lastBatchFrame !== null) {
      this.#lastFrame = lastBatchFrame;
      for (const [uid, info] of this.#pending) if (info.frame <= lastBatchFrame) this.#pending.delete(uid);
    }
    return { frames: out, passDurationsMs, lastBatchFrame, unattributedPasses, incompleteFrames, staleFrames };
  }
}

/** Greatest common divisor of whole nanoseconds. */
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Fewer nonzero durations than this cannot tell a coarse timer from chance. */
const MIN_RESOLUTION_SAMPLES = 8;
/**
 * A step this coarse means the browser rounds timestamps. Chrome without its WebGPU Developer Features flag rounds
 * to tens of microseconds; with the flag, steps are about a microsecond.
 */
export const QUANTIZED_TIMESTAMP_NS = 10_000;

export interface TimestampResolution {
  /** The largest step every nonzero duration is a whole multiple of, in ns; `null` with too few samples. */
  readonly resolutionNs: number | null;
  /** `true` when `resolutionNs` is at least {@link QUANTIZED_TIMESTAMP_NS}: the durations are rounded. */
  readonly quantized: boolean;
  readonly samples: number;
}

/**
 * Infers the timestamp step from durations in ms. Three.js converts whole nanoseconds to ms, so `ms * 1e6` rounds
 * back to the exact count; durations between two rounded timestamps are whole multiples of the rounding step.
 */
export function timestampResolution(durationsMs: readonly number[]): TimestampResolution {
  let step = 0;
  let samples = 0;
  for (const ms of durationsMs) {
    const ns = Math.round(ms * 1e6);
    if (!Number.isFinite(ns) || ns <= 0) continue;
    step = gcd(step, ns);
    samples++;
  }
  if (samples < MIN_RESOLUTION_SAMPLES) return { resolutionNs: null, quantized: false, samples };
  return { resolutionNs: step, quantized: step >= QUANTIZED_TIMESTAMP_NS, samples };
}
