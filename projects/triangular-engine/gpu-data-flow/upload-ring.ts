import { FlowBuffer, FlowDevice } from './flow-device';

export interface UploadRingOptions {
  /** Most bytes written to the device per frame. Larger writes are split and finish over several frames. */
  bytesPerFrame: number;
}

export interface UploadTelemetry {
  bytesPerFrame: number;
  queueDepth: number;
  queuedBytes: number;
  peakQueueDepth: number;
  bytesLastFrame: number;
  totalBytes: number;
  totalWrites: number;
  completed: number;
}

interface Pending {
  target: FlowBuffer;
  offset: number;
  data: Uint8Array;
  done?: () => void;
}

/**
 * CPU to GPU writes with a per-frame byte budget. `enqueue` never touches the device; `flush()` writes up to the
 * budget in first-in order and leaves the rest queued. A write larger than the budget is split into 4-byte aligned
 * chunks. Queue depth is a metric.
 */
export class UploadRing {
  private readonly queue: Pending[] = [];
  private queuedBytes = 0;
  private peakDepth = 0;
  private lastFrameBytes = 0;
  private totalBytes = 0;
  private totalWrites = 0;
  private completed = 0;
  private budget: number;

  constructor(
    private readonly device: FlowDevice,
    options: UploadRingOptions,
  ) {
    this.budget = UploadRing.checkBudget(options.bytesPerFrame);
  }

  private static checkBudget(bytes: number): number {
    if (!(bytes >= 4)) throw new RangeError('bytesPerFrame must be at least 4');
    return Math.floor(bytes / 4) * 4;
  }

  setBudget(bytesPerFrame: number): void {
    this.budget = UploadRing.checkBudget(bytesPerFrame);
  }

  /**
   * Queue `data` for `target` at `offset`. The bytes are not copied: do not change them until `onDone` fires.
   * Offset and length must be multiples of 4.
   */
  enqueue(target: FlowBuffer, offset: number, data: ArrayBufferView, onDone?: () => void): void {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (offset % 4 !== 0 || bytes.byteLength % 4 !== 0) {
      throw new RangeError('offset and byte length must be multiples of 4');
    }
    if (offset + bytes.byteLength > target.size) {
      throw new RangeError(
        `upload of ${bytes.byteLength} bytes at ${offset} overruns "${target.label}" (${target.size} bytes)`,
      );
    }
    if (bytes.byteLength === 0) {
      onDone?.();
      return;
    }
    this.queue.push({ target, offset, data: bytes, done: onDone });
    this.queuedBytes += bytes.byteLength;
    this.peakDepth = Math.max(this.peakDepth, this.queue.length);
  }

  /** Write up to the frame budget. Call once per frame. Returns the bytes written. */
  flush(): number {
    let left = this.budget;
    let written = 0;
    while (left > 0 && this.queue.length > 0) {
      const item = this.queue[0];
      const n = Math.min(item.data.byteLength, left);
      const whole = n === item.data.byteLength;
      this.device.writeBuffer(item.target, item.offset, whole ? item.data : item.data.subarray(0, n));
      this.totalWrites++;
      written += n;
      left -= n;
      this.queuedBytes -= n;
      if (whole) {
        this.queue.shift();
        this.completed++;
        item.done?.();
      } else {
        item.data = item.data.subarray(n);
        item.offset += n;
      }
    }
    this.lastFrameBytes = written;
    this.totalBytes += written;
    return written;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  telemetry(): UploadTelemetry {
    return {
      bytesPerFrame: this.budget,
      queueDepth: this.queue.length,
      queuedBytes: this.queuedBytes,
      peakQueueDepth: this.peakDepth,
      bytesLastFrame: this.lastFrameBytes,
      totalBytes: this.totalBytes,
      totalWrites: this.totalWrites,
      completed: this.completed,
    };
  }
}
