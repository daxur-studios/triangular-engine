import { DEFAULT_FLOW_LIMITS, FlowDeviceLimits } from './flow-device';

export type CapacityKind = 'storage' | 'buffer' | 'uniform';

/** Thrown before the device would be lost: a buffer larger than a limit, or a total over the budget. */
export class GpuCapacityError extends Error {
  constructor(
    message: string,
    readonly label: string,
    readonly requestedBytes: number,
    readonly limitBytes: number,
    readonly limitName: string,
  ) {
    super(message);
    this.name = 'GpuCapacityError';
  }
}

export interface CapacityGuardOptions {
  /** Device limits; defaults to the WebGPU defaults. */
  limits?: FlowDeviceLimits;
  /** Use only this fraction of every limit (0..1], to leave headroom. Default 1. */
  headroom?: number;
  /** Optional cap on the sum of all reserved bytes (a memory budget for this module). */
  maxTotalBytes?: number;
}

export interface CapacityTelemetry {
  reservedBytes: number;
  peakReservedBytes: number;
  reservations: number;
  rejected: number;
  maxTotalBytes: number | null;
}

const LIMIT_NAME: Record<CapacityKind, keyof FlowDeviceLimits> = {
  storage: 'maxStorageBufferBindingSize',
  uniform: 'maxUniformBufferBindingSize',
  buffer: 'maxBufferSize',
};

/** Checks buffer growth against device limits and tracks the bytes this module holds. */
export class CapacityGuard {
  readonly limits: FlowDeviceLimits;
  private readonly headroom: number;
  private readonly maxTotalBytes: number | null;
  private reserved = 0;
  private peak = 0;
  private count = 0;
  private rejected = 0;

  constructor(options: CapacityGuardOptions = {}) {
    this.limits = options.limits ?? DEFAULT_FLOW_LIMITS;
    const headroom = options.headroom ?? 1;
    if (!(headroom > 0 && headroom <= 1)) throw new RangeError('headroom must be in (0, 1]');
    this.headroom = headroom;
    this.maxTotalBytes = options.maxTotalBytes ?? null;
  }

  /** Largest single buffer of `kind` that may be created. Storage and uniform are also capped by `maxBufferSize`. */
  maxBytes(kind: CapacityKind): number {
    const raw = Math.min(this.limits[LIMIT_NAME[kind]], this.limits.maxBufferSize);
    return Math.floor(raw * this.headroom);
  }

  /** Throws `GpuCapacityError` if one buffer of `bytes` is not allowed. Reserves nothing. */
  check(bytes: number, kind: CapacityKind, label: string): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError(`${label}: invalid size ${bytes}`);
    const max = this.maxBytes(kind);
    if (bytes > max) {
      this.rejected++;
      const name = LIMIT_NAME[kind];
      throw new GpuCapacityError(
        `${label}: ${bytes} bytes exceeds ${name} (${max} bytes usable of ${this.limits[name]}). ` +
          `Split the data across buffers or shrink the grid.`,
        label,
        bytes,
        max,
        name,
      );
    }
  }

  /** Check and count `bytes`; returns a function that releases them. Also enforces `maxTotalBytes`. */
  reserve(bytes: number, kind: CapacityKind, label: string): () => void {
    this.check(bytes, kind, label);
    if (this.maxTotalBytes !== null && this.reserved + bytes > this.maxTotalBytes) {
      this.rejected++;
      throw new GpuCapacityError(
        `${label}: ${bytes} bytes would take the reserved total to ${this.reserved + bytes}, over the budget of ${this.maxTotalBytes} bytes.`,
        label,
        this.reserved + bytes,
        this.maxTotalBytes,
        'maxTotalBytes',
      );
    }
    this.reserved += bytes;
    this.peak = Math.max(this.peak, this.reserved);
    this.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reserved -= bytes;
    };
  }

  telemetry(): CapacityTelemetry {
    return {
      reservedBytes: this.reserved,
      peakReservedBytes: this.peak,
      reservations: this.count,
      rejected: this.rejected,
      maxTotalBytes: this.maxTotalBytes,
    };
  }
}
