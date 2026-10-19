import { describeRendererGpu, type TestSetting } from 'triangular-engine/testing';

/** The slice of a three.js renderer this reads; structural so a spec can pass a plain object. */
export interface GpuAdapterRendererLike {
  readonly backend?: {
    readonly isWebGPUBackend?: boolean;
    readonly device?: {
      readonly adapterInfo?: Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>> & { readonly isFallbackAdapter?: boolean };
      readonly features?: { has(name: string): boolean };
    };
  };
  readonly domElement?: { readonly width: number; readonly height: number };
  getPixelRatio?(): number;
}

const SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

/**
 * Flat description of the GPU the renderer actually uses, plus the drawing buffer. three.js 0.186.1 does not keep the
 * adapter it requests, so the info comes from the device it created (`GPUDevice.adapterInfo`), which is that adapter's.
 * The `gpu.*` fields come from the library's `describeRendererGpu`; this adds the lab's own extras.
 */
export function describeGpuAdapter(renderer: GpuAdapterRendererLike | undefined, devicePixelRatio: number): Record<string, TestSetting> {
  const backend = renderer?.backend;
  const info = backend?.device?.adapterInfo;
  const describedBy = [info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ');
  return {
    backend: backend === undefined ? 'none' : backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    'gpu.source': info ? 'renderer.backend.device.adapterInfo' : 'unavailable',
    ...describeRendererGpu(renderer),
    'gpu.isFallbackAdapter': info?.isFallbackAdapter ?? null,
    'gpu.software': info ? info.isFallbackAdapter === true || SOFTWARE.test(describedBy) : null,
    'gpu.timestampQuery': backend?.device?.features ? backend.device.features.has('timestamp-query') : null,
    'canvas.drawingBufferWidth': renderer?.domElement?.width ?? 0,
    'canvas.drawingBufferHeight': renderer?.domElement?.height ?? 0,
    devicePixelRatio,
    rendererPixelRatio: renderer?.getPixelRatio?.() ?? null,
  };
}

/** One line for the HUD, e.g. "nvidia ada-lovelace (RTX ...)". */
export function adapterLabel(description: Record<string, TestSetting>): string {
  if (description['gpu.source'] === 'unavailable') return 'adapter unavailable';
  const parts = [description['gpu.vendor'], description['gpu.architecture'], description['gpu.device'], description['gpu.description']]
    .filter((part) => part !== 'unknown' && part !== '' && part !== null && part !== undefined);
  return parts.length ? parts.join(' / ') : 'adapter reported nothing';
}
