import { FlowBuffer, FlowClock, FlowDevice, defaultFlowClock } from './flow-device';
import { LatencySummary, LatencyWindow } from './latency-window';

export interface ReadbackRingOptions {
  /** Number of reads that may be in flight. */
  slots: number;
  /** Largest read, in bytes (multiple of 4). Results the CPU needs are small and fixed in size. */
  slotBytes: number;
  clock?: FlowClock;
  /** Samples kept for the statistics. Default 128. */
  window?: number;
}

export interface ReadbackResult<T = unknown> {
  /** Frame the request was submitted in: the frame the data belongs to. */
  frame: number;
  /** Frame the result was handed to the CPU in. */
  deliveredFrame: number;
  /** Caller data passed to `request`. */
  tag: T;
  data: ArrayBuffer;
  /** Submit to usable on the CPU, milliseconds. */
  latencyMs: number;
  /** Submit to delivered, in frames. */
  latencyFrames: number;
}

export interface ReadbackTelemetry {
  slots: number;
  slotBytes: number;
  inFlight: number;
  ready: number;
  requested: number;
  delivered: number;
  /** Requests refused because every slot was busy. */
  dropped: number;
  failed: number;
  latencyMs: LatencySummary;
  latencyFrames: LatencySummary;
}

interface Done<T> {
  frame: number;
  tag: T;
  data: ArrayBuffer;
  latencyMs: number;
}

/**
 * Scheduled GPU to CPU reads. `request` queues a copy and a map and returns at once; `poll` hands over whatever has
 * arrived. Nothing here awaits the GPU, so a frame never blocks. Each result carries the frame it was requested in.
 */
export class ReadbackRing<T = unknown> {
  private readonly free: FlowBuffer[] = [];
  private readonly ready: Done<T>[] = [];
  private readonly clock: FlowClock;
  private readonly ms: LatencyWindow;
  private readonly frames: LatencyWindow;
  private inFlight = 0;
  private requested = 0;
  private delivered = 0;
  private dropped = 0;
  private failed = 0;
  private destroyed = false;
  /** The most recent map failure, if any. */
  lastError: unknown = null;

  constructor(
    private readonly device: FlowDevice,
    private readonly options: ReadbackRingOptions,
  ) {
    if (options.slots < 1) throw new RangeError('slots must be at least 1');
    if (options.slotBytes < 4 || options.slotBytes % 4 !== 0) {
      throw new RangeError('slotBytes must be a multiple of 4');
    }
    this.clock = options.clock ?? defaultFlowClock;
    this.ms = new LatencyWindow(options.window);
    this.frames = new LatencyWindow(options.window);
    for (let i = 0; i < options.slots; i++) {
      this.free.push(device.createBuffer({ size: options.slotBytes, kind: 'readback', label: `readback-slot-${i}` }));
    }
  }

  /**
   * Read `size` bytes (default the slot size) of `src` at `srcOffset`, tagged with `frame`. Returns false when every
   * slot is busy: the request is dropped and counted, never waited for.
   */
  request(src: FlowBuffer, srcOffset: number, frame: number, tag: T, size = this.options.slotBytes): boolean {
    if (this.destroyed) throw new Error('ReadbackRing is destroyed');
    if (size > this.options.slotBytes || size % 4 !== 0 || srcOffset % 4 !== 0) {
      throw new RangeError(`readback of ${size} bytes at ${srcOffset} does not fit a ${this.options.slotBytes}-byte slot`);
    }
    const slot = this.free.pop();
    if (!slot) {
      this.dropped++;
      return false;
    }
    const submittedAt = this.clock();
    this.requested++;
    this.inFlight++;
    this.device.copyBuffer(src, srcOffset, slot, 0, size);
    this.device.mapRead(slot, 0, size).then(
      (data) => {
        this.inFlight--;
        if (this.destroyed) {
          slot.destroy();
          return;
        }
        this.free.push(slot);
        this.ready.push({ frame, tag, data, latencyMs: this.clock() - submittedAt });
      },
      (error) => {
        this.inFlight--;
        this.failed++;
        this.lastError = error;
        if (this.destroyed) slot.destroy();
        else this.free.push(slot);
      },
    );
    return true;
  }

  /** Take every result that has arrived, oldest first. `frame` is the current frame. */
  poll(frame: number): ReadbackResult<T>[] {
    return this.ready.splice(0).map((r) => {
      const latencyFrames = frame - r.frame;
      this.ms.record(r.latencyMs);
      this.frames.record(latencyFrames);
      this.delivered++;
      return { frame: r.frame, deliveredFrame: frame, tag: r.tag, data: r.data, latencyMs: r.latencyMs, latencyFrames };
    });
  }

  get freeSlots(): number {
    return this.free.length;
  }

  telemetry(): ReadbackTelemetry {
    return {
      slots: this.options.slots,
      slotBytes: this.options.slotBytes,
      inFlight: this.inFlight,
      ready: this.ready.length,
      requested: this.requested,
      delivered: this.delivered,
      dropped: this.dropped,
      failed: this.failed,
      latencyMs: this.ms.summary(),
      latencyFrames: this.frames.summary(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    for (const s of this.free) s.destroy();
    this.free.length = 0;
    this.ready.length = 0;
  }
}
