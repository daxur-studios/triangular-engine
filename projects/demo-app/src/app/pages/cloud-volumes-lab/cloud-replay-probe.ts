import type { EngineService } from 'triangular-engine';
import { PerspectiveCamera, RenderTarget, SRGBColorSpace, UnsignedByteType } from 'three';

/** Plan 052 U0 only. Deliberately isolated from the shared adapter/public engine API. */
interface ReplayHost {
  configure(mode: 'mesh' | 'proxy'): void;
  move(fraction: number): void;
  state(): unknown;
  clouds(visible: boolean): void;
}

export interface CloudReplayOptions {
  frames: number;
  captureFrames: number[];
  pauseEvery?: number;
  pauseMs?: number;
  fault?: 'missing-render' | 'missing-cloud';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function bounded<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(code)), ms);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

export function installCloudReplayProbe(engine: EngineService, host: ReplayHost): () => void {
  // U0 intentionally depends on pinned Three.js internals to falsify the clock assumption first.
  // Any shared/public stepping API must be designed only after this experiment passes.
  const renderer = () => engine.renderer as any;
  let disposed = false;
  let prepared = false;
  let running = false;
  let replayed = false;
  let frame = 0;
  let completed = 0;
  let stamp = 0;
  let warmupElapsed = 0;
  let nodeUpdate: (() => void) | undefined;
  let target: RenderTarget | undefined;
  let originalOutput: RenderTarget | null = null;
  let inStep = false;
  let wrapper: HTMLElement | null = null;
  let wrapperStyle: string | null = null;
  const errors: string[] = [];
  const rendered = engine.renderComplete$.subscribe(() => {
    completed++;
    if (prepared && !inStep) errors.push(`UNEXPECTED_EXTERNAL_RENDER: ${new Error().stack}`);
  });
  const errored = engine.error$.subscribe((event) => errors.push(`${event.phase}: ${String(event.error)}`));

  const check = () => {
    if (disposed) throw new Error('PROBE_DISPOSED');
    if (errors.length) throw new Error(`ENGINE_ERROR: ${errors.join('; ')}`);
  };
  const fence = async () => {
    const backend = renderer().backend;
    if (backend.isWebGPUBackend) await bounded(backend.device.queue.onSubmittedWorkDone(), 15000, 'GPU_FENCE_TIMEOUT');
    else backend.gl.finish();
    check();
  };
  const renderStep = async (missing = false) => {
    check();
    const before = completed;
    const node = renderer()._nodes.nodeFrame;
    node.time = frame / 60;
    node.deltaTime = 1 / 60;
    node.frameId = frame + 1;
    const cpuStart = performance.now();
    inStep = true;
    try { if (!missing) engine.tick(stamp + frame * (1000 / 60)); }
    finally { inStep = false; }
    const cpuMs = performance.now() - cpuStart;
    if (completed !== before + 1) throw new Error(`MISSING_RENDER: frame ${frame}, completed ${completed - before}`);
    await fence();
    const gpuMs = renderer().backend.trackTimestamp
      ? await bounded(renderer().resolveTimestampsAsync('render'), 15000, 'GPU_TIMESTAMP_TIMEOUT')
      : undefined;
    check();
    return { cpuMs, gpuMs: typeof gpuMs === 'number' && Number.isFinite(gpuMs) && gpuMs > 0 ? gpuMs : null };
  };
  const capture = async () => {
    const width = target!.width;
    const height = target!.height;
    const pixels = await bounded(renderer().readRenderTargetPixelsAsync(target, 0, 0, width, height), 15000, 'CAPTURE_TIMEOUT') as Uint8Array;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const rgba = new Uint8ClampedArray(pixels.length);
    // WebGL's framebuffer origin is bottom-left; WebGPU's is top-left.
    for (let y = 0; y < height; y++) {
      const sourceY = renderer().backend.isWebGPUBackend ? y : height - 1 - y;
      rgba.set(pixels.subarray(sourceY * width * 4, (sourceY + 1) * width * 4), y * width * 4);
    }
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    return { width, height, png: canvas.toDataURL('image/png') };
  };
  const profile = () => {
    const backend = renderer()?.backend;
    const info = backend?.device?.adapterInfo;
    const gl = backend?.gl;
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      backend: backend?.isWebGPUBackend ? 'webgpu' : backend?.isWebGLBackend ? 'webgl2' : 'unknown',
      adapter: info ? {
        vendor: info.vendor, architecture: info.architecture, device: info.device,
        description: info.description, isFallbackAdapter: info.isFallbackAdapter ?? null,
      } : null,
      glRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      timestampSupported: backend?.trackTimestamp === true,
      visibility: document.visibilityState, focused: document.hasFocus(),
      width: target?.width, height: target?.height, dpr: devicePixelRatio,
      threeClock: 'explicit NodeFrame time/delta/frameId; internal animation stopped (U0 private hook)',
      gpuCompletion: backend?.isWebGPUBackend ? 'queue.onSubmittedWorkDone per frame' : 'gl.finish per frame',
      performanceValidity: 'diagnostic-only; external contention uncontrolled; serialized replay includes fences',
    };
  };

  const probe = {
    version: 'cloud-replay-u0-v1',
    async prepare(options: { mode?: 'mesh' | 'proxy'; readinessTimeoutMs?: number; fault?: 'readiness' } = {}) {
      if (running || prepared) throw new Error('PREPARE_REQUIRES_FRESH_PAGE');
      running = true;
      try {
        const deadline = performance.now() + Math.min(options.readinessTimeoutMs ?? 30000, 30000);
        while (!renderer()?.initialized || options.fault === 'readiness') {
          check();
          if (performance.now() >= deadline) throw new Error('READINESS_TIMEOUT');
          await delay(20);
        }
        // Freeze the actual observed wrapper, not just the offscreen target. Otherwise app/HUD
        // layout can enqueue a resize render in the middle of a paused deterministic journey.
        wrapper = renderer().domElement.closest('.canvas-size-observer');
        if (!wrapper) throw new Error('SCENE_WRAPPER_REQUIRED');
        wrapperStyle = wrapper.getAttribute('style');
        Object.assign(wrapper.style, { position: 'fixed', left: '0', top: '0', width: '640px', height: '360px', flex: 'none' });
        while (engine.width !== 640 || engine.height !== 360) {
          check();
          if (performance.now() >= deadline) throw new Error('VIEWPORT_SETTLE_TIMEOUT');
          await delay(20);
        }
        engine.stopLoop();
        renderer()._animation.stop();
        const node = renderer()._nodes.nodeFrame;
        nodeUpdate = node.update;
        node.update = () => { /* All shader clocks are written by renderStep. */ };
        engine.clock.disconnect();
        stamp = performance.now();
        engine.clock.update(stamp);
        engine.setSpeedFactor(1);
        engine.setFPSLimit(0);
        engine.elapsedTime$.next(0);
        // Suppress the FPSController's 1 Hz traversal using its existing sampling window.
        engine.fpsController.frameSampler.start();
        host.configure(options.mode ?? 'mesh');
        host.move(0);
        originalOutput = renderer().getOutputRenderTarget();
        target = new RenderTarget(640, 360, { type: UnsignedByteType });
        target.texture.colorSpace = SRGBColorSpace;
        renderer().setPixelRatio(1);
        renderer().setSize(640, 360, false);
        const camera = engine.camera;
        if (!(camera instanceof PerspectiveCamera)) throw new Error('PERSPECTIVE_CAMERA_REQUIRED');
        camera.aspect = 640 / 360;
        camera.updateProjectionMatrix();
        renderer().setOutputRenderTarget(target);
        // Cold shader compilation and first density/light bakes are discarded, but still checked.
        for (frame = 1; frame <= 8; frame++) await renderStep();
        warmupElapsed = engine.elapsedTime$.value;
        frame = 8;
        prepared = true;
        return profile();
      } finally {
        running = false;
      }
    },
    profile,
    async run(options: CloudReplayOptions) {
      if (!prepared || replayed) throw new Error('RUN_REQUIRES_FRESH_PREPARED_PAGE');
      if (running) throw new Error('PROBE_BUSY');
      if (!Number.isInteger(options.frames) || options.frames < 2 || options.frames > 1200) throw new Error('INVALID_FRAME_COUNT');
      if ((options.pauseMs ?? 0) < 0 || (options.pauseMs ?? 0) > 1000) throw new Error('INVALID_PAUSE');
      running = true;
      replayed = true;
      const started = performance.now();
      const samples = [];
      const captures = [];
      const startingCompleted = completed;
      try {
        for (let index = 0; index < options.frames; index++) {
          check();
          if (index && options.pauseEvery && index % options.pauseEvery === 0) await delay(options.pauseMs ?? 0);
          frame = index + 9;
          if (completed !== startingCompleted + index) throw new Error('UNEXPECTED_EXTRA_RENDER');
          host.move(index / (options.frames - 1));
          if (options.fault === 'missing-cloud') host.clouds(false);
          const timing = await renderStep(options.fault === 'missing-render' && index === Math.floor(options.frames / 2));
          if (completed !== startingCompleted + index + 1) throw new Error('UNEXPECTED_EXTRA_RENDER');
          const node = renderer()._nodes.nodeFrame;
          const state = {
            frame: index, simulatedSeconds: (index + 1) / 60,
            engineSeconds: engine.elapsedTime$.value - warmupElapsed,
            shaderSeconds: node.time, shaderFrame: node.frameId,
            camera: { position: engine.camera.position.toArray(), quaternion: engine.camera.quaternion.toArray() },
            scene: host.state(),
          };
          samples.push({ ...state, ...timing });
          if (options.captureFrames.includes(index)) captures.push({ frame: index, ...await capture() });
        }
        return { profile: profile(), frames: options.frames, wallMs: performance.now() - started, samples, captures, errors: [...errors] };
      } finally {
        host.clouds(true);
        running = false;
      }
    },
  };
  const global = window as unknown as { __cloudReplayProbe?: typeof probe };
  global.__cloudReplayProbe = probe;
  return () => {
    disposed = true;
    rendered.unsubscribe();
    errored.unsubscribe();
    if (nodeUpdate) renderer()._nodes.nodeFrame.update = nodeUpdate;
    if (target) {
      renderer().setOutputRenderTarget(originalOutput);
      target.dispose();
    }
    if (wrapper) {
      if (wrapperStyle === null) wrapper.removeAttribute('style');
      else wrapper.setAttribute('style', wrapperStyle);
    }
    engine.fpsController.frameSampler.stop();
    if (global.__cloudReplayProbe === probe) delete global.__cloudReplayProbe;
  };
}
