import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  isDevMode,
  computed,
  signal,
} from '@angular/core';
import { Color } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import {
  FAN_MODES,
  FAN_RAY_OPTIONS,
  LOD_METRICS,
  MORPH_POSE_IDS,
  createLodSurfaceMorphSpikeScene,
  type ILodSurfaceMorphSpikeDiagnostics,
  type ILodSurfaceMorphSpikeSceneHandle,
  type MorphMethod,
  type MorphPoseId,
  type MorphSpikeState,
  type CrackProbeOptions,
  type CrackRow,
  type FanProbeOptions,
  type FanProbeRow,
  type FanRebuildOptions,
  type FanRebuildRow,
  type LodMetric,
  type ProbeOptions,
  type ProbeResult,
} from './core';
import { createMorphSpikeTestAdapter, type MorphSpikeTestHost } from './morph-spike-test-adapter';
import { MORPH_SPIKE_TEST_HISTORY, type MorphSpikeTestSettings } from './morph-spike-tests';

/** Diagnostics samples (every 500 ms) the page waits for the renderer's device before it lets a test run start anyway. */
const DEVICE_WAIT_SAMPLES = 10;

/** The slice of the renderer the page's test environment reads. */
interface RendererLike {
  readonly backend?: { readonly isWebGPUBackend?: boolean; readonly device?: { readonly adapterInfo?: unknown } };
  readonly domElement?: { readonly width: number; readonly height: number };
}

/** The test handle on `window`: run the precision probe and set the spike's state from the console or a test. */
export interface LodMorphSpikeWindowApi {
  runProbe(options?: ProbeOptions): Promise<ProbeResult[]>;
  setState(patch: Partial<MorphSpikeState>): void;
  getState(): MorphSpikeState;
  /** The rows of the last probe run. */
  lastProbe: ProbeResult[];
  /** Runs the crack probe (part 2): holes inside the map's outline per radius, morph and view, plus the known-bad controls. */
  runCrackProbe(options?: CrackProbeOptions): Promise<CrackRow[]>;
  /** The rows of the last crack probe run. */
  lastCrackProbe: CrackRow[];
  /** Runs the fan precision probe (iteration 5): the vertex-stage fan's positions against a double reference, in pixels. */
  runFanProbe(options?: FanProbeOptions): Promise<FanProbeRow[]>;
  /** Runs the scripted camera move and morph change with each fan mode and counts the fan's rebuilds. */
  runFanRebuild(options?: FanRebuildOptions): Promise<FanRebuildRow[]>;
  lastFanProbe: FanProbeRow[];
  lastFanRebuild: FanRebuildRow[];
}

declare global {
  interface Window {
    __lodMorphSpike?: LodMorphSpikeWindowApi;
  }
}

/**
 * Plan 059 morph spike (D11, before G6), part 1: the LOD terrain bent from globe to map with the vertex stage written as
 * differences from a per-frame anchor, so a 2 m view of a 600 km or 6,371 km planet keeps vertex error under a pixel at
 * morph 0.5 and 1. The page draws the bent sphere, steers the camera in the bent frame and runs a GPU precision probe
 * against a double-precision reference (`window.__lodMorphSpike.runProbe()`).
 *
 * What this file is responsible for and nothing more: providing `EngineService` (so `<scene>` in the template owns the
 * renderer, camera, tick loop, resize handling, and the free `showFPS` overlay) and wiring UI controls through to the
 * `core/` factory's handle. The mechanism under test lives in `core/`.
 */
@Component({
  selector: 'app-lod-surface-morph-spike',
  imports: [EngineModule, TestRunnerComponent],
  templateUrl: './lod-surface-morph-spike.component.html',
  styleUrl: './lod-surface-morph-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, reversedDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class LodSurfaceMorphSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: ILodSurfaceMorphSpikeSceneHandle;

  readonly radii = [{ label: '600 km', value: 600_000 }, { label: '6,371 km', value: 6_371_000 }];
  readonly morphPresets = [0, 1e-4, 0.5, 1];
  readonly poseIds = MORPH_POSE_IDS;
  readonly methods: MorphMethod[] = ['p2', 'naive'];
  readonly lodMetrics: readonly LodMetric[] = LOD_METRICS;
  /** Leaf caps the page offers (the mesh holds up to 16,384). */
  readonly leafCaps: readonly number[] = [4096, 8192, 16_384];
  /** Rays per full turn the pole fan offers. */
  readonly fanRayOptions: readonly number[] = FAN_RAY_OPTIONS;
  /** The fans the page offers: 'cpu' (iteration 4) and 'vertex' (iteration 5, the vertex stage evaluates the positions). */
  readonly fanModes = FAN_MODES;

  readonly state = signal<MorphSpikeState>(undefined as unknown as MorphSpikeState);
  readonly diagnostics = signal<ILodSurfaceMorphSpikeDiagnostics | undefined>(undefined);
  readonly probeRows = signal<ProbeResult[]>([]);
  readonly probeStatus = signal('');
  readonly probeRunning = signal(false);
  readonly crackRows = signal<CrackRow[]>([]);
  readonly crackStatus = signal('');
  readonly crackRunning = signal(false);
  readonly fanStatus = signal('');
  readonly fanRunning = signal(false);

  /** Browser tests (`triangular-engine/testing`): the suite history, the adapter over the probes, and the dev-only launch link. */
  readonly testHistory = MORPH_SPIKE_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();
  /** A test run is in progress: the controls are locked so it cannot be changed under the probe. */
  readonly runnerBusy = signal(false);
  /**
   * The renderer has its GPU device: the test runner reads `gpu.*` once when a run starts, and a run that starts between the backend
   * object and its device records the adapter as unknown. Gives up waiting after `DEVICE_WAIT_SAMPLES` samples (a browser that
   * reports no adapter info), so the page is never held back for good.
   */
  private readonly rendererReady = signal(false);
  private deviceWaits = 0;
  /** The scene has drawn a frame, so a probe has a renderer and a compiled pipeline. */
  readonly sceneReady = computed(() => this.diagnostics() !== undefined && this.rendererReady());
  readonly testAdapter: TestRunAdapter<MorphSpikeTestSettings, MorphSpikeState>;

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.scene = createLodSurfaceMorphSpikeScene(this.engine, (diagnostics) => {
      const backend = (this.engine.renderer as unknown as RendererLike).backend;
      if (!this.rendererReady() && (backend?.device?.adapterInfo !== undefined || backend?.isWebGPUBackend === false || ++this.deviceWaits > DEVICE_WAIT_SAMPLES)) {
        this.rendererReady.set(true);
      }
      this.diagnostics.set(diagnostics);
    });
    this.state.set(this.scene.getState());
    const host: MorphSpikeTestHost = {
      read: () => this.scene.getState(),
      apply: (patch) => this.update(patch),
      ready: () => this.sceneReady(),
      backendIsWebGpu: () => (this.engine.renderer as unknown as RendererLike).backend?.isWebGPUBackend === true,
      runProbe: (options) => this.runProbe(options),
      runCrackProbe: (options) => this.runCrackProbe(options),
      runFanProbe: (options) => this.runFanProbe(options),
      runFanRebuild: (options) => this.runFanRebuild(options),
      environment: () => this.testEnvironment(),
    };
    this.testAdapter = createMorphSpikeTestAdapter(host);
    const api: LodMorphSpikeWindowApi = {
      lastProbe: [],
      lastCrackProbe: [],
      lastFanProbe: [],
      lastFanRebuild: [],
      runProbe: (options) => this.runProbe(options),
      runCrackProbe: (options) => this.runCrackProbe(options),
      runFanProbe: (options) => this.runFanProbe(options),
      runFanRebuild: (options) => this.runFanRebuild(options),
      setState: (patch) => this.update(patch),
      getState: () => this.scene.getState(),
    };
    window.__lodMorphSpike = api;
    this.destroyRef.onDestroy(() => {
      if (window.__lodMorphSpike === api) delete window.__lodMorphSpike;
      this.scene.dispose();
    });
  }

  update(patch: Partial<MorphSpikeState>): void {
    this.scene.setState(patch);
    this.state.set(this.scene.getState());
  }

  onTestProgress(progress: TestProgress | null): void {
    this.runnerBusy.set(progress !== null);
  }

  private testEnvironment(): Record<string, TestSetting> {
    const renderer = this.engine.renderer as unknown as RendererLike;
    return {
      backend: renderer.backend === undefined ? 'none' : renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
      ...describeRendererGpu(renderer as Parameters<typeof describeRendererGpu>[0]),
      'canvas.drawingBufferWidth': renderer.domElement?.width ?? 0,
      'canvas.drawingBufferHeight': renderer.domElement?.height ?? 0,
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      'gpu.deviceReady': renderer.backend?.device !== undefined,
      'gpu.adapterInfoPresent': renderer.backend?.device?.adapterInfo !== undefined,
    };
  }

  setMorph(value: number): void {
    this.update({ morph: Math.min(1, Math.max(0, value)) });
  }

  setNumber(key: 'centreLonDeg' | 'centreLatDeg' | 'heightM', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.update({ [key]: value });
  }

  setPose(id: MorphPoseId): void {
    this.update({ poseId: id });
  }

  toggleWireframe(): void {
    this.update({ wireframe: !this.state().wireframe });
  }

  async runProbe(options?: ProbeOptions): Promise<ProbeResult[]> {
    if (this.probeRunning()) throw new Error('The probe is already running');
    this.probeRunning.set(true);
    this.probeRows.set([]);
    this.probeStatus.set('running…');
    try {
      const rows: ProbeResult[] = [];
      const results = await this.scene.runProbe({
        ...options,
        onProgress: (done, total, row) => {
          rows.push(row);
          this.probeRows.set([...rows]);
          this.probeStatus.set(`${done} / ${total}`);
          options?.onProgress?.(done, total, row);
        },
      });
      this.probeStatus.set(`done, ${results.length} rows`);
      if (window.__lodMorphSpike) window.__lodMorphSpike.lastProbe = results;
      return results;
    } catch (error) {
      this.probeStatus.set(`failed: ${String(error)}`);
      throw error;
    } finally {
      this.probeRunning.set(false);
    }
  }

  async runCrackProbe(options?: CrackProbeOptions): Promise<CrackRow[]> {
    if (this.crackRunning()) throw new Error('The crack probe is already running');
    this.crackRunning.set(true);
    this.crackRows.set([]);
    this.crackStatus.set('running…');
    try {
      const rows: CrackRow[] = [];
      const results = await this.scene.runCrackProbe({
        ...options,
        onProgress: (done, total, row) => {
          rows.push(row);
          this.crackRows.set([...rows]);
          this.crackStatus.set(`${done} / ${total}`);
          options?.onProgress?.(done, total, row);
        },
      });
      this.crackStatus.set(`done, ${results.length} rows`);
      if (window.__lodMorphSpike) window.__lodMorphSpike.lastCrackProbe = results;
      return results;
    } catch (error) {
      this.crackStatus.set(`failed: ${String(error)}`);
      throw error;
    } finally {
      this.crackRunning.set(false);
    }
  }

  async runFanProbe(options?: FanProbeOptions): Promise<FanProbeRow[]> {
    const rows = await this.runFanTask('fan precision', (onProgress) => this.scene.runFanProbe({ ...options, onProgress: (d, t, r) => { onProgress(d, t); options?.onProgress?.(d, t, r); } }));
    if (window.__lodMorphSpike) window.__lodMorphSpike.lastFanProbe = rows;
    return rows;
  }

  async runFanRebuild(options?: FanRebuildOptions): Promise<FanRebuildRow[]> {
    const rows = await this.runFanTask('fan rebuilds', (onProgress) => this.scene.runFanRebuild({ ...options, onProgress: (d, t, r) => { onProgress(d, t); options?.onProgress?.(d, t, r); } }));
    if (window.__lodMorphSpike) window.__lodMorphSpike.lastFanRebuild = rows;
    return rows;
  }

  /** One of the fan probes with the page's status line. */
  private async runFanTask<T>(name: string, run: (onProgress: (done: number, total: number) => void) => Promise<T[]>): Promise<T[]> {
    if (this.fanRunning()) throw new Error('A fan probe is already running');
    this.fanRunning.set(true);
    this.fanStatus.set(`${name}: running…`);
    try {
      const rows = await run((done, total) => this.fanStatus.set(`${name}: ${done} / ${total}`));
      this.fanStatus.set(`${name}: done, ${rows.length} rows`);
      return rows;
    } catch (error) {
      this.fanStatus.set(`${name}: failed: ${String(error)}`);
      throw error;
    } finally {
      this.fanRunning.set(false);
    }
  }

  /** The pole bands of a row as a tooltip: vertices, max px, p99 px, worst distance. */
  bandsText(row: ProbeResult): string {
    return row.poleBands
      .map((b) => `q ${b.label}: n ${b.vertices}, max ${this.fmt(b.maxErrPx)} px, p99 ${this.fmt(b.p99ErrPx)} px, worst at ${this.fmt(b.worstDistM)} m`)
      .join('\n');
  }

  /** Metres and pixels with three significant figures. */
  fmt(value: number): string {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    return abs >= 1000 || abs < 0.001 ? value.toExponential(2) : value.toPrecision(3);
  }
}
