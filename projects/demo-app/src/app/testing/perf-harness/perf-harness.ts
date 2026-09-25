import { Group } from 'three';
import type { Subscription } from 'rxjs';
import type { EngineService } from 'triangular-engine';
import {
  PERF_SCENARIOS,
  findPerfScenario,
  resolvePerfParams,
  type PerfFrameInfo,
  type PerfScenarioCheck,
  type PerfScenarioFacts,
  type PerfScenarioHost,
  type PerfScenarioInstance,
  type PerfScenarioParams,
} from './perf-scenarios';

export const PERF_BRIDGE_VERSION = 'perf-bridge-v1';

export interface PerfMeasureRequest {
  /** Real-time warm-up before sampling starts. Default 1000 ms. */
  warmupMs?: number;
  /** Sampling window length. Default 3000 ms. */
  durationMs?: number;
}

/** Raw, unsummarized samples. Statistics are computed by the Node side. */
export interface PerfWindow {
  scenario: string;
  startedAt: number;
  durationMs: number;
  frames: number;
  /** Wall-clock interval between consecutive completed renders. */
  frameIntervalMs: number[];
  /** Whole `engine.tick()` duration: tick$ subscribers + render submission + telemetry. */
  cpuFrameMs: number[];
  /** `engine.render()` duration only (CPU-side submission, not GPU execution). */
  renderCpuMs: number[];
  /** Scenario-recorded named samples, e.g. `scenarioUpdateMs`. */
  custom: Record<string, number[]>;
  drawCalls: { min: number; max: number; last: number };
  triangles: { min: number; max: number; last: number };
  longTasks: Array<{ startTime: number; duration: number }>;
  hiddenFrames: number;
  heapUsedBytes: { before: number | null; after: number | null };
  gcForced: boolean;
  errors: PerfHarnessError[];
}

export interface PerfLoadResult {
  scenario: string;
  version: number;
  params: PerfScenarioParams;
  /** Time to construct the scenario (scene objects, component mount). */
  setupMs: number;
  /** Time from construction end to the first completed render (includes shader compile/upload). */
  firstFrameMs: number;
  facts: PerfFacts;
}

export interface PerfFacts {
  scenario: string | null;
  frame: PerfFrameInfo;
  overhead: PerfFrameInfo;
  renderer: { drawCalls: number; triangles: number; geometries: number; textures: number; programs: number };
  scenarioFacts: PerfScenarioFacts;
  checks: PerfScenarioCheck[];
}

export interface PerfBrowserEnvironment {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  devicePixelRatio: number;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number };
  webgl: { version: string; vendor: string; renderer: string; unmaskedVendor: string | null; unmaskedRenderer: string | null } | null;
  visibilityState: DocumentVisibilityState;
  telemetry: string;
}

export interface PerfHarnessError {
  source: string;
  message: string;
  at: number;
}

export interface PerfBridge {
  readonly version: typeof PERF_BRIDGE_VERSION;
  scenarios(): Array<{ id: string; version: number; title: string; description: string; defaults: PerfScenarioParams }>;
  environment(): PerfBrowserEnvironment;
  load(id: string, params?: PerfScenarioParams): Promise<PerfLoadResult>;
  measure(request?: PerfMeasureRequest): Promise<PerfWindow>;
  facts(): Promise<PerfFacts>;
  unload(): Promise<void>;
  errors(): PerfHarnessError[];
}

const MAX_SAMPLES = 200_000;
const FRAME_TIMEOUT_MS = 10_000;

type Tickable = { tick(time: number): void; render(time: number, force?: boolean, deltaTime?: number): void };

/**
 * In-page performance harness. It owns scenario lifecycle on one engine and
 * samples real frames while the ordinary animation loop runs.
 *
 * Timing sources (all `performance.now()`, CPU main thread):
 * - frame interval: between `renderComplete$` emissions — the throughput a
 *   user sees, bounded below by vsync unless the browser is uncapped.
 * - cpuFrameMs / renderCpuMs: wraps the engine instance's `tick`/`render`
 *   methods. This is test-only instrumentation, installed on the instance
 *   (never the prototype) and removed on `destroy()`.
 *
 * None of these is GPU execution time. The engine's FPSController keeps
 * running (it is part of the production frame cost) and is reported as such.
 */
export class PerfHarness implements PerfBridge {
  readonly version = PERF_BRIDGE_VERSION;

  private readonly root = new Group();
  private active?: { id: string; version: number; params: PerfScenarioParams; instance: PerfScenarioInstance };
  private readonly subscriptions: Subscription[] = [];
  private readonly errorLog: PerfHarnessError[] = [];
  private overhead: PerfFrameInfo = { drawCalls: 0, triangles: 0 };
  private lastFrame = { drawCalls: 0, triangles: 0 };
  private recording?: PerfRecording;
  private busy = false;
  private readonly onWindowError = (event: ErrorEvent) => this.pushError('window.error', event.message);
  private readonly onRejection = (event: PromiseRejectionEvent) => this.pushError('unhandledrejection', String(event.reason));

  constructor(
    private readonly engine: EngineService,
    private readonly host: PerfScenarioHost = {},
  ) {
    this.root.name = 'perf-harness-root';
    this.engine.scene.add(this.root);
    this.instrument();
    this.subscriptions.push(
      this.engine.renderComplete$.subscribe((frame) => this.onRenderComplete(frame.renderedAt)),
      this.engine.tick$.subscribe((delta) => this.onTick(delta)),
      this.engine.error$.subscribe((error) => this.pushError(`engine.${error.phase}`, String(error.error))),
    );
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  scenarios() {
    return PERF_SCENARIOS.map(({ id, version, title, description, defaults }) => ({ id, version, title, description, defaults }));
  }

  environment(): PerfBrowserEnvironment {
    const canvas = this.engine.renderer?.domElement as HTMLCanvasElement | undefined;
    const rect = canvas?.getBoundingClientRect();
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      devicePixelRatio: window.devicePixelRatio,
      canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0, cssWidth: rect?.width ?? 0, cssHeight: rect?.height ?? 0 },
      webgl: this.webglInfo(),
      visibilityState: document.visibilityState,
      telemetry: 'engine FPSController active (production default)',
    };
  }

  async load(id: string, params: PerfScenarioParams = {}): Promise<PerfLoadResult> {
    return this.exclusive(async () => {
      await this.unloadActive();
      // Establish the empty-scene draw overhead so scenario checks can
      // assert exact counts regardless of what the page itself renders.
      await this.frames(2);
      this.overhead = { ...this.lastFrame };

      const definition = findPerfScenario(id);
      const resolved = resolvePerfParams(definition, params);
      const started = performance.now();
      const instance = await definition.create(
        { root: this.root, camera: this.engine.camera, host: this.host, recordSample: (name, value) => this.recordSample(name, value) },
        resolved,
      );
      const created = performance.now();
      this.active = { id, version: definition.version, params: resolved, instance };
      const firstFrameAt = await this.frames(1);
      // Two more frames so facts reflect a steady state rather than the upload frame.
      await this.frames(2);
      return {
        scenario: id,
        version: definition.version,
        params: resolved,
        setupMs: created - started,
        firstFrameMs: firstFrameAt - created,
        facts: this.currentFacts(),
      };
    });
  }

  async measure(request: PerfMeasureRequest = {}): Promise<PerfWindow> {
    return this.exclusive(async () => {
      if (!this.active) throw new Error('NOT_LOADED: call load() before measure()');
      const warmupMs = request.warmupMs ?? 1000;
      const durationMs = request.durationMs ?? 3000;
      await delay(warmupMs);
      const gc = (window as Window & { gc?: () => void }).gc;
      if (gc) gc();
      const recording = new PerfRecording(this.active.id, heapUsed(), Boolean(gc), this.errorLog.length);
      this.recording = recording;
      await delay(durationMs);
      this.recording = undefined;
      recording.finish(heapUsed());
      return recording.toWindow(this.errorLog);
    });
  }

  async facts(): Promise<PerfFacts> {
    await this.frames(1);
    return this.currentFacts();
  }

  async unload(): Promise<void> {
    return this.exclusive(() => this.unloadActive());
  }

  errors(): PerfHarnessError[] {
    return [...this.errorLog];
  }

  destroy(): void {
    this.recording = undefined;
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    const instance = this.active?.instance;
    this.active = undefined;
    void instance?.dispose();
    this.root.removeFromParent();
    // Remove the instance-level wrappers; the prototype methods take over again.
    delete (this.engine as unknown as Partial<Tickable>).tick;
    delete (this.engine as unknown as Partial<Tickable>).render;
  }

  private instrument(): void {
    const engine = this.engine as unknown as Tickable;
    const tick = engine.tick;
    const render = engine.render;
    engine.tick = (time: number) => {
      const started = performance.now();
      tick.call(this.engine, time);
      this.recording?.push('cpuFrameMs', performance.now() - started);
    };
    engine.render = (time: number, force?: boolean, deltaTime?: number) => {
      const started = performance.now();
      render.call(this.engine, time, force, deltaTime);
      this.recording?.push('renderCpuMs', performance.now() - started);
    };
  }

  private onTick(delta: number): void {
    const update = this.active?.instance.update;
    if (!update) return;
    try {
      update(delta, this.engine.elapsedTime$.value);
    } catch (error) {
      this.pushError('scenario.update', error instanceof Error ? error.message : String(error));
    }
  }

  private onRenderComplete(renderedAt: number): void {
    const info = this.engine.renderer?.info;
    this.lastFrame = { drawCalls: info?.render.calls ?? 0, triangles: info?.render.triangles ?? 0 };
    this.recording?.frame(renderedAt, this.lastFrame.drawCalls, this.lastFrame.triangles, document.visibilityState === 'hidden');
  }

  private recordSample(name: string, value: number): void {
    this.recording?.push(name, value);
  }

  private currentFacts(): PerfFacts {
    const frame: PerfFrameInfo = {
      drawCalls: this.lastFrame.drawCalls - this.overhead.drawCalls,
      triangles: this.lastFrame.triangles - this.overhead.triangles,
    };
    const info = this.engine.renderer?.info;
    return {
      scenario: this.active?.id ?? null,
      frame,
      overhead: { ...this.overhead },
      renderer: {
        drawCalls: this.lastFrame.drawCalls,
        triangles: this.lastFrame.triangles,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
        programs: (info as { programs?: unknown[] } | undefined)?.programs?.length ?? 0,
      },
      scenarioFacts: this.active?.instance.facts() ?? {},
      checks: this.active?.instance.checks(frame) ?? [],
    };
  }

  private async unloadActive(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    if (active) await active.instance.dispose();
    this.root.clear();
  }

  /** Resolves with `renderedAt` of the n-th completed render from now. */
  private frames(count: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let remaining = count;
      const timeout = window.setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error(`TIMEOUT: ${remaining} of ${count} frames did not render within ${FRAME_TIMEOUT_MS} ms`));
      }, FRAME_TIMEOUT_MS);
      const subscription = this.engine.renderComplete$.subscribe((frame) => {
        if (--remaining > 0) return;
        window.clearTimeout(timeout);
        subscription.unsubscribe();
        resolve(frame.renderedAt);
      });
    });
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('BUSY: another perf command is in flight');
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }

  private pushError(source: string, message: string): void {
    if (this.errorLog.length < 200) this.errorLog.push({ source, message, at: performance.now() });
  }

  private webglInfo(): PerfBrowserEnvironment['webgl'] {
    const renderer = this.engine.renderer as { getContext?: () => WebGLRenderingContext | WebGL2RenderingContext } | undefined;
    const gl = renderer?.getContext?.();
    if (!gl || typeof gl.getParameter !== 'function') return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: String(gl.getParameter(gl.VERSION)),
      vendor: String(gl.getParameter(gl.VENDOR)),
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmaskedVendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : null,
      unmaskedRenderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
    };
  }
}

class PerfRecording {
  private readonly startedAt = performance.now();
  private endedAt = this.startedAt;
  private lastRenderedAt?: number;
  private frames = 0;
  private hiddenFrames = 0;
  private readonly series: Record<string, number[]> = {};
  private readonly drawCalls = { min: Infinity, max: 0, last: 0 };
  private readonly triangles = { min: Infinity, max: 0, last: 0 };
  private readonly longTasks: Array<{ startTime: number; duration: number }> = [];
  private readonly observer?: PerformanceObserver;
  private heapAfter: number | null = null;

  constructor(
    private readonly scenario: string,
    private readonly heapBefore: number | null,
    private readonly gcForced: boolean,
    private readonly errorOffset: number,
  ) {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.longTasks.push({ startTime: entry.startTime - this.startedAt, duration: entry.duration });
      });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      this.observer = undefined;
    }
  }

  push(name: string, value: number): void {
    const list = (this.series[name] ??= []);
    if (list.length < MAX_SAMPLES) list.push(value);
  }

  frame(renderedAt: number, drawCalls: number, triangles: number, hidden: boolean): void {
    this.frames++;
    if (hidden) this.hiddenFrames++;
    if (this.lastRenderedAt !== undefined) this.push('frameIntervalMs', renderedAt - this.lastRenderedAt);
    this.lastRenderedAt = renderedAt;
    track(this.drawCalls, drawCalls);
    track(this.triangles, triangles);
  }

  finish(heapAfter: number | null): void {
    this.endedAt = performance.now();
    this.heapAfter = heapAfter;
    this.observer?.disconnect();
  }

  toWindow(errors: PerfHarnessError[]): PerfWindow {
    const { frameIntervalMs = [], cpuFrameMs = [], renderCpuMs = [], ...custom } = this.series;
    return {
      scenario: this.scenario,
      startedAt: this.startedAt,
      durationMs: this.endedAt - this.startedAt,
      frames: this.frames,
      frameIntervalMs,
      cpuFrameMs,
      renderCpuMs,
      custom,
      drawCalls: finite(this.drawCalls),
      triangles: finite(this.triangles),
      longTasks: this.longTasks,
      hiddenFrames: this.hiddenFrames,
      heapUsedBytes: { before: this.heapBefore, after: this.heapAfter },
      gcForced: this.gcForced,
      errors: errors.slice(this.errorOffset),
    };
  }
}

function track(target: { min: number; max: number; last: number }, value: number): void {
  target.min = Math.min(target.min, value);
  target.max = Math.max(target.max, value);
  target.last = value;
}

function finite(value: { min: number; max: number; last: number }) {
  return { ...value, min: Number.isFinite(value.min) ? value.min : 0 };
}

function heapUsed(): number | null {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
