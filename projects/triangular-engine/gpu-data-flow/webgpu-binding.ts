import { DEFAULT_FLOW_LIMITS, FlowBuffer, FlowBufferKind, FlowDevice } from './flow-device';

/**
 * Structural subsets of the WebGPU types, so this entry compiles without `@webgpu/types` and accepts both a raw
 * `GPUDevice` and the device of three's `WebGPURenderer`.
 */
export interface GpuBufferLike {
  readonly size: number;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GpuDeviceLike {
  readonly limits: Record<string, number>;
  readonly queue: {
    writeBuffer(buffer: any, offset: number, data: any, dataOffset?: number, size?: number): void;
    submit(commands: any[]): void;
  };
  createBuffer(desc: { size: number; usage: number; label?: string }): GpuBufferLike;
  createCommandEncoder(): {
    copyBufferToBuffer(src: any, srcOffset: number, dst: any, dstOffset: number, size: number): void;
    finish(): unknown;
  };
}

// GPUBufferUsage and GPUMapMode values, fixed by the WebGPU spec.
const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;

export interface WebGpuFlowBuffer extends FlowBuffer {
  /** The underlying `GPUBuffer`, to bind in a pipeline. */
  readonly gpu: GpuBufferLike;
}

class WebGpuBuffer implements WebGpuFlowBuffer {
  constructor(
    readonly gpu: GpuBufferLike,
    readonly size: number,
    readonly label: string,
    readonly kind: FlowBufferKind,
  ) {}
  destroy(): void {
    this.gpu.destroy();
  }
}

/** A `FlowDevice` over a raw WebGPU device. Each `copyBuffer` submits its own tiny command buffer. */
export function createWebGpuFlowDevice(device: GpuDeviceLike): FlowDevice {
  const gpuOf = (b: FlowBuffer) => (b as WebGpuBuffer).gpu;
  const limit = (name: string, fallback: number) => device.limits?.[name] ?? fallback;
  return {
    limits: {
      maxStorageBufferBindingSize: limit('maxStorageBufferBindingSize', DEFAULT_FLOW_LIMITS.maxStorageBufferBindingSize),
      maxBufferSize: limit('maxBufferSize', DEFAULT_FLOW_LIMITS.maxBufferSize),
      maxUniformBufferBindingSize: limit('maxUniformBufferBindingSize', DEFAULT_FLOW_LIMITS.maxUniformBufferBindingSize),
    },
    createBuffer({ size, kind, label = 'flow-buffer' }) {
      const usage = kind === 'storage' ? STORAGE | COPY_SRC | COPY_DST : MAP_READ | COPY_DST;
      return new WebGpuBuffer(device.createBuffer({ size, usage, label }), size, label, kind);
    },
    writeBuffer(target, offset, data) {
      device.queue.writeBuffer(gpuOf(target), offset, data.buffer, data.byteOffset, data.byteLength);
    },
    copyBuffer(src, srcOffset, dst, dstOffset, size) {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(gpuOf(src), srcOffset, gpuOf(dst), dstOffset, size);
      device.queue.submit([encoder.finish()]);
    },
    async mapRead(buffer, offset, size) {
      const gpu = gpuOf(buffer);
      await gpu.mapAsync(MAP_MODE_READ, offset, size);
      const copy = gpu.getMappedRange(offset, size).slice(0);
      gpu.unmap();
      return copy;
    },
  };
}

/**
 * The raw device behind a three `WebGPURenderer` (`renderer.backend.device`), once it has initialised. Null on the
 * WebGL fallback or before `await renderer.init()`.
 */
export function webGpuDeviceOf(renderer: unknown): GpuDeviceLike | null {
  const device = (renderer as { backend?: { device?: GpuDeviceLike } } | null)?.backend?.device;
  return device ?? null;
}

/** Wrap a `GPUBuffer` you own (for example one behind a render storage buffer) so the rings can copy from it. */
export function adoptGpuBuffer(gpu: GpuBufferLike, kind: FlowBufferKind = 'storage', label = 'adopted'): WebGpuFlowBuffer {
  return new WebGpuBuffer(gpu, gpu.size, label, kind);
}
