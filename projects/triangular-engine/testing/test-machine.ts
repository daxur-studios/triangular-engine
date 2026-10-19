import type { TestSetting } from './test-contracts';

/**
 * The fields of a WebGPU `GPUAdapterInfo` this entry reads. Declared structurally so the entry needs no WebGPU typings
 * and a page can pass the adapter info of whichever renderer it actually uses.
 */
export interface TestGpuAdapterInfo {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

export type TestGpuBackend = 'webgpu' | 'webgl' | 'unknown';

/** The parts of a Three.js renderer that `describeRendererGpu` reads (a WebGPU or WebGL fallback backend). */
export interface TestRendererGpuSource {
  readonly backend?: {
    readonly isWebGPUBackend?: boolean;
    readonly isWebGLBackend?: boolean;
    readonly device?: { readonly adapterInfo?: TestGpuAdapterInfo };
    readonly gl?: {
      getExtension(name: string): unknown;
      getParameter(parameter: number): unknown;
    };
  };
}

const UNKNOWN = 'unknown';
const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;

const label = (value: string | undefined): string => (value && value.trim() ? value.trim() : UNKNOWN);

/**
 * Flat `gpu.*` settings for an adapter's `environment()` hook, so every result names the GPU it ran on.
 * Browsers may blank some fields; blanks are labelled `unknown`. Pass the info of the adapter the renderer really uses,
 * never one requested separately: a second `requestAdapter()` can return a different GPU on a hybrid-graphics machine.
 * Without adapter info the vendor is `unknown` and a performance run is not a hardware number.
 */
export function describeGpuAdapter(
  info: TestGpuAdapterInfo | undefined, backend: TestGpuBackend = info ? 'webgpu' : 'unknown',
): Record<string, TestSetting> {
  return {
    'gpu.backend': backend,
    'gpu.vendor': label(info?.vendor),
    'gpu.architecture': label(info?.architecture),
    'gpu.device': label(info?.device),
    'gpu.description': label(info?.description),
  };
}

/**
 * `describeGpuAdapter` for a Three.js renderer. Three.js 0.186 does not keep the `GPUAdapter`, but the device it created
 * exposes `adapterInfo`; the WebGL fallback reports the unmasked vendor and renderer strings when the browser allows.
 */
export function describeRendererGpu(renderer: TestRendererGpuSource | null | undefined): Record<string, TestSetting> {
  const backend = renderer?.backend;
  if (backend?.isWebGPUBackend) return describeGpuAdapter(backend.device?.adapterInfo, 'webgpu');
  if (backend?.isWebGLBackend) {
    try {
      const gl = backend.gl;
      if (gl?.getExtension('WEBGL_debug_renderer_info')) {
        return describeGpuAdapter({
          vendor: String(gl.getParameter(UNMASKED_VENDOR_WEBGL) ?? ''), description: String(gl.getParameter(UNMASKED_RENDERER_WEBGL) ?? ''),
        }, 'webgl');
      }
    } catch { /* extension blocked: fall through to an unlabeled adapter */ }
    return describeGpuAdapter(undefined, 'webgl');
  }
  return describeGpuAdapter(undefined);
}

/**
 * The validity issue for a performance case whose recorded GPU is not the one the suite expects, or `undefined`.
 * `expected` matches the recorded `gpu.vendor` case-insensitively as a substring (for example `nvidia`).
 */
export function gpuVendorIssue(expected: string | undefined, environment: Readonly<Record<string, TestSetting>>): string | undefined {
  if (!expected) return undefined;
  const recorded = String(environment['gpu.vendor'] ?? UNKNOWN);
  if (recorded === UNKNOWN) return `GPU adapter not recorded (expected vendor ${expected})`;
  return recorded.toLowerCase().includes(expected.toLowerCase()) ? undefined : `GPU vendor ${recorded} differs from expected ${expected}`;
}

/** Messages a session sends to the result receiver so it can sample the machine around a timing case. */
export type TestMachineMessageKind = 'prepare' | 'start' | 'stop';

export interface TestMachineMessage {
  readonly runId: string;
  readonly suiteId: string;
  readonly suiteVersion: number;
  /** Absent for `prepare`, which is per run. */
  readonly scenarioId?: string;
  readonly repetition?: number;
}

/** Longest the page lets one machine message hang before giving up. */
export const MACHINE_MESSAGE_TIMEOUT_MS = 1000;

/**
 * `POST <sink>/machine/<kind>` with a short timeout. Fire-and-forget: the promise never rejects, a missing, slow or
 * erroring receiver is ignored, and the body is `text/plain` so a cross-origin receiver URL needs no CORS preflight.
 */
export function sendMachineMessage(
  sink: string, kind: TestMachineMessageKind, message: TestMachineMessage, timeoutMs = MACHINE_MESSAGE_TIMEOUT_MS,
): Promise<void> {
  if (typeof fetch !== 'function') return Promise.resolve();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return fetch(`${sink.replace(/\/+$/, '')}/machine/${kind}`, {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(message),
      signal: controller.signal, keepalive: true,
    }).then(() => undefined, () => undefined).finally(() => clearTimeout(timer));
  } catch { clearTimeout(timer); return Promise.resolve(); }
}
