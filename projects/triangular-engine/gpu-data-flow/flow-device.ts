/**
 * The small device surface the data-flow core needs. Everything in this entry is written against it, so the logic
 * runs in specs with a fake. `createWebGpuFlowDevice` is the real binding.
 */

/** What a buffer is for: GPU-side storage (copy source and target) or a map-readable readback slot. */
export type FlowBufferKind = 'storage' | 'readback';

export interface FlowBuffer {
  readonly size: number;
  readonly label: string;
  readonly kind: FlowBufferKind;
  destroy(): void;
}

export interface FlowDeviceLimits {
  /** Largest binding of one storage buffer (WebGPU default 128 MiB). */
  readonly maxStorageBufferBindingSize: number;
  /** Largest buffer of any kind (WebGPU default 256 MiB). */
  readonly maxBufferSize: number;
  /** Largest uniform binding (WebGPU default 64 KiB). */
  readonly maxUniformBufferBindingSize: number;
}

/** The WebGPU default limits, used when a device does not report its own. */
export const DEFAULT_FLOW_LIMITS: FlowDeviceLimits = {
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxUniformBufferBindingSize: 64 * 1024,
};

export interface FlowDevice {
  readonly limits: FlowDeviceLimits;
  createBuffer(desc: { size: number; kind: FlowBufferKind; label?: string }): FlowBuffer;
  /** Queue a CPU to GPU write. Offset and byte length are multiples of 4. */
  writeBuffer(target: FlowBuffer, offset: number, data: Uint8Array): void;
  /** Queue a GPU copy. Offsets and size are multiples of 4. */
  copyBuffer(src: FlowBuffer, srcOffset: number, dst: FlowBuffer, dstOffset: number, size: number): void;
  /** Resolve with a copy of the bytes once the GPU has finished the copies queued before. Never awaited in a frame. */
  mapRead(buffer: FlowBuffer, offset: number, size: number): Promise<ArrayBuffer>;
}

/** Milliseconds; specs pass a fake. */
export type FlowClock = () => number;

export const defaultFlowClock: FlowClock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();
