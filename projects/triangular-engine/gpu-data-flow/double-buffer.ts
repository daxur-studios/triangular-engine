import { CapacityGuard } from './capacity-guard';
import { FlowBuffer, FlowDevice } from './flow-device';

export interface DoubleBufferTelemetry {
  label: string;
  sizeBytes: number;
  swaps: number;
  grows: number;
}

/**
 * Two storage buffers of one size: the GPU reads `read` while it writes `write`; call `swap()` once per frame. Growth
 * is checked against the device limits first and throws `GpuCapacityError` instead of losing the device.
 */
export class DoubleBuffer {
  private buffers: [FlowBuffer, FlowBuffer];
  private releases: [() => void, () => void];
  private index = 0;
  private swaps = 0;
  private grows = 0;

  constructor(
    private readonly device: FlowDevice,
    private readonly guard: CapacityGuard,
    sizeBytes: number,
    readonly label = 'double-buffer',
  ) {
    const [a, ra] = this.make(sizeBytes, 'a');
    let b: FlowBuffer;
    let rb: () => void;
    try {
      [b, rb] = this.make(sizeBytes, 'b');
    } catch (e) {
      a.destroy();
      ra();
      throw e;
    }
    this.buffers = [a, b];
    this.releases = [ra, rb];
  }

  private make(size: number, side: string): [FlowBuffer, () => void] {
    const name = `${this.label}/${side}`;
    const release = this.guard.reserve(size, 'storage', name);
    try {
      return [this.device.createBuffer({ size, kind: 'storage', label: name }), release];
    } catch (e) {
      release();
      throw e;
    }
  }

  get read(): FlowBuffer {
    return this.buffers[this.index];
  }

  get write(): FlowBuffer {
    return this.buffers[1 - this.index];
  }

  get size(): number {
    return this.buffers[0].size;
  }

  swap(): void {
    this.index = 1 - this.index;
    this.swaps++;
  }

  /**
   * Grow both buffers to `sizeBytes`, keeping the `read` contents (copied on the GPU). The limit check runs before
   * anything is created. Returns false when the buffers are already large enough.
   */
  grow(sizeBytes: number): boolean {
    if (sizeBytes <= this.size) return false;
    this.guard.check(sizeBytes, 'storage', this.label);
    const oldRead = this.read;
    const oldSize = this.size;
    const old = this.buffers;
    const oldReleases = this.releases;
    const [a, ra] = this.make(sizeBytes, 'a');
    let b: FlowBuffer;
    let rb: () => void;
    try {
      [b, rb] = this.make(sizeBytes, 'b');
    } catch (e) {
      a.destroy();
      ra();
      throw e;
    }
    this.device.copyBuffer(oldRead, 0, a, 0, oldSize);
    this.buffers = [a, b];
    this.releases = [ra, rb];
    this.index = 0;
    for (const o of old) o.destroy();
    for (const r of oldReleases) r();
    this.grows++;
    return true;
  }

  telemetry(): DoubleBufferTelemetry {
    return { label: this.label, sizeBytes: this.size, swaps: this.swaps, grows: this.grows };
  }

  destroy(): void {
    for (const b of this.buffers) b.destroy();
    for (const r of this.releases) r();
  }
}
