import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { FlatTerrainComponent } from 'triangular-engine/lod-surface';
import { TestRunnerComponent, type TestContext, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import {
  createWaterLodSpikeScene,
  type IWaterLodSpikeSceneHandle,
} from './core';
import { toLuminance, type ILuminanceImage } from './core/water-lod-spike-image-metrics';
import { runWaterLodSpikePrecisionProbe, type IPrecisionProbeRenderer } from './core/water-lod-spike-precision-probe';
import { WATER_LOD_SPIKE_QUALITIES, waterLodSpikeQuality, type WaterLodSpikeQualityId } from './core/water-lod-spike-quality';
import { WATER_LOD_SPIKE_UNIFORMS } from './core/water-lod-spike-waves';
import {
  createWaterLodSpikeTestAdapter,
  WATER_LOD_SPIKE_TEST_HISTORY,
  type WaterLodSpikeTestSettings,
  type WaterLodSpikeView,
} from './water-lod-spike-tests';

/** Wave time (s) the aliasing cases freeze the water at, so every arm and the reference see the same surface. */
const TEST_WAVE_TIME_S = 12.5;

/**
 * Spike W0b (Plan 080, LOD Water): does analytic wave water on a flat plane keep its near and far forms matched, with
 * no colour step at handover and no shimmer, within the plan 080 gates? The water is a 100 km `<flatTerrain>` fed by
 * the spike's 64-wave spectrum and its own material (`core/`): per-wave footprint filtering in the shading, mesh-spacing
 * filtering on the vertices, and the filtered slope variance moved into the glint roughness.
 *
 * What this file is responsible for and nothing more: providing `EngineService` (so `<scene>` owns the renderer,
 * camera, tick loop, resize handling, and the free `showFPS` overlay), binding the water body, wiring UI toggles through
 * to the `core/` factory's handle, and hosting the test runner (`water-lod-spike-tests.ts`), including the fixed test
 * views and the canvas readback the aliasing suite measures.
 */
@Component({
  selector: 'app-water-lod-spike',
  imports: [EngineModule, FlatTerrainComponent, TestRunnerComponent],
  templateUrl: './water-lod-spike.component.html',
  styleUrl: './water-lod-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      gpuTiming: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, reversedDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterLodSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  /** Plane edge length, metres (plan 080: 100 km flat plane). */
  protected readonly planeSizeM = 100_000;
  protected readonly water: IWaterLodSpikeSceneHandle;

  readonly testHistory = WATER_LOD_SPIKE_TEST_HISTORY;
  /** Autostart from a launch link is a dev-only convenience; the owner's dev server is in dev mode. */
  readonly allowTestAutoStart = isDevMode();
  readonly testAdapter: TestRunAdapter<WaterLodSpikeTestSettings, boolean>;

  readonly wireframe = signal(false);
  /** True while the vertex heights are forced to zero (the shading normal is kept). */
  readonly flatVertices = signal(false);
  /** Footprint and mesh-spacing filters (off shows the aliasing the filters remove). */
  readonly filter = signal(true);
  readonly animating = signal(true);
  /** Quality tier: waves evaluated, footprint bias and mesh density. */
  readonly quality = signal<WaterLodSpikeQualityId>('ultra');
  readonly qualities = WATER_LOD_SPIKE_QUALITIES;
  protected readonly qualityTier = computed(() => waterLodSpikeQuality(this.quality()));
  protected readonly qualityIndex = computed(() => WATER_LOD_SPIKE_QUALITIES.findIndex((tier) => tier.id === this.quality()));
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  /** True once the water body has drawn, so a test case has something to look at. */
  readonly sceneReady = computed(() => this.drawCalls() > 0);
  /** True while a test case is measuring or warming up; drives the red outline on the scene. */
  readonly testing = signal(false);
  /**
   * The fixed view a test case holds the camera at. The orbit controls stay on, looking at the view's target (switching
   * them off makes them resume the held pose when they come back); the hold re-applies the position every frame.
   */
  readonly heldView = signal<WaterLodSpikeView | null>(null);
  /** The point the orbit controls look at: the held view's target while a test holds the camera, else the origin. */
  protected readonly orbitTarget = computed<[number, number, number]>(() => {
    const target = this.heldView()?.target;
    return target ? [target[0], target[1], target[2]] : [0, 0, 0];
  });
  /** Frame intervals (ms) collected while a performance case measures; null when not sampling. */
  private frameTimes: number[] | null = null;
  private cpuTimes: number[] | null = null;
  private lastFrameMs = 0;
  private renderedFrames = 0;
  /** Camera position before a test view took it, put back (looking at the orbit target) when the view is released. */
  private savedPosition: Vector3 | null = null;
  private savedPixelRatio: number | null = null;
  private savedQuality: WaterLodSpikeQualityId | null = null;
  private scratch: CanvasRenderingContext2D | null = null;

  /** GPU vendor from the WebGPU adapter, filled in once the adapter resolves. */
  private gpuVendor = 'unknown';

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.water = createWaterLodSpikeScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
    });
    this.destroyRef.onDestroy(() => this.water.dispose());
    const frameSubscription = this.engine.tick$.subscribe(() => {
      const nowMs = performance.now();
      if (this.frameTimes && this.lastFrameMs > 0) {
        this.frameTimes.push(nowMs - this.lastFrameMs);
        // The previous frame's tick-and-render time on the CPU, as the FPS panel shows it.
        this.cpuTimes?.push(this.engine.fpsController.cpuFrameTime());
      }
      this.lastFrameMs = nowMs;
      this.renderedFrames++;
    });
    // A held test view is re-applied every frame after the controls' tick, so nothing moves the camera off it.
    const holdSubscription = this.engine.lateUpdate$.subscribe(() => {
      const view = this.heldView();
      if (view) this.pointCamera(view);
    });
    this.destroyRef.onDestroy(() => {
      frameSubscription.unsubscribe();
      holdSubscription.unsubscribe();
    });
    this.testAdapter = createWaterLodSpikeTestAdapter({
      ready: () => this.sceneReady(),
      wireframe: () => this.water.material.wireframe,
      setWireframe: (enabled) => {
        this.wireframe.set(enabled);
        this.water.setWireframe(enabled);
      },
      counts: () => ({ drawCalls: this.drawCalls(), triangles: this.triangles() }),
      beginFrameSampling: () => {
        this.frameTimes = [];
        this.cpuTimes = [];
        this.lastFrameMs = 0;
      },
      endFrameSampling: () => {
        const frames = this.frameTimes ?? [];
        this.frameTimes = null;
        return frames;
      },
      takeCpuFrameMs: () => {
        const cpu = this.cpuTimes ?? [];
        this.cpuTimes = null;
        return cpu;
      },
      gpuFrameMs: () => this.engine.fpsController.gpuFrameTime(),
      setView: (view) => this.holdView(view),
      setFilter: (enabled) => this.water.setFilter(enabled),
      setTransfer: (enabled) => this.water.setTransfer(enabled),
      setPixelRatio: (ratio) => this.holdPixelRatio(ratio),
      setQuality: (id) => this.holdQuality(id),
      waitFrames: (count, context) => this.waitFrames(count, context),
      readFrame: (jitterX, jitterY) => this.readFrame(jitterX, jitterY),
      horizonRow: () => this.horizonRow(),
      runPrecisionProbe: () => runWaterLodSpikePrecisionProbe(this.engine.renderer as unknown as IPrecisionProbeRenderer, String(this.environment()['backend'])),
      environment: () => this.environment(),
    });
    void navigator.gpu?.requestAdapter().then((adapter) => {
      this.gpuVendor = adapter?.info?.vendor || 'unknown';
    });
  }

  onTestProgress(progress: TestProgress | null): void {
    this.testing.set(progress?.phase === 'measuring' || progress?.phase === 'warmup');
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    this.water.setWireframe(this.wireframe());
  }

  /** Zero-height toggle (architect decision, W0b): flattens the mesh and keeps the shading normal. */
  toggleFlatVertices(): void {
    this.flatVertices.update((flat) => !flat);
    WATER_LOD_SPIKE_UNIFORMS.vertexHeightScale.value = this.flatVertices() ? 0 : 1;
  }

  toggleFilter(): void {
    this.filter.update((enabled) => !enabled);
    this.water.setFilter(this.filter());
  }

  toggleAnimating(): void {
    this.animating.update((enabled) => !enabled);
    this.water.setAnimating(this.animating());
  }

  /** Picks a quality tier from the slider (an index into the tiers, best first). */
  onQualitySlider(event: Event): void {
    const tier = WATER_LOD_SPIKE_QUALITIES[Number((event.target as HTMLInputElement).value)];
    if (tier) this.setQuality(tier.id);
  }

  setQuality(id: WaterLodSpikeQualityId): void {
    this.water.setQuality(id);
    this.quality.set(id);
  }

  private holdQuality(id: WaterLodSpikeQualityId | null): void {
    if (id !== null) {
      this.savedQuality ??= this.quality();
      this.setQuality(id);
      return;
    }
    if (this.savedQuality !== null) this.setQuality(this.savedQuality);
    this.savedQuality = null;
  }

  private holdPixelRatio(ratio: number | null): void {
    const renderer = this.engine.renderer;
    if (ratio !== null) {
      this.savedPixelRatio ??= renderer.getPixelRatio();
      renderer.setPixelRatio(ratio * this.savedPixelRatio);
      return;
    }
    if (this.savedPixelRatio !== null) renderer.setPixelRatio(this.savedPixelRatio);
    this.savedPixelRatio = null;
  }

  private holdView(view: WaterLodSpikeView | null): void {
    const camera = this.engine.camera;
    if (view) {
      this.savedPosition ??= camera.position.clone();
      this.water.setAnimating(false);
      this.water.setTime(TEST_WAVE_TIME_S);
      this.heldView.set(view);
      this.pointCamera(view);
      return;
    }
    this.heldView.set(null);
    if (this.savedPosition) {
      camera.position.copy(this.savedPosition);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      this.savedPosition = null;
    }
    this.water.setAnimating(this.animating());
  }

  private pointCamera(view: WaterLodSpikeView): void {
    const camera = this.engine.camera;
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
  }

  private async waitFrames(count: number, context: TestContext): Promise<void> {
    const start = this.renderedFrames;
    while (this.renderedFrames < start + count) await context.wait(16);
  }

  /** Renders the current view now, offset by a sub-pixel amount, and copies the canvas in the same task (WebGPU canvases read back only then). */
  private readFrame(jitterX: number, jitterY: number): ILuminanceImage {
    const camera = this.engine.camera;
    const canvas = this.engine.canvas;
    const { width, height } = canvas;
    if (!width || !height) throw new Error('The canvas has no size to read');
    if (camera instanceof PerspectiveCamera) {
      camera.setViewOffset(width, height, jitterX, jitterY, width, height);
    }
    try {
      this.engine.render(this.engine.fpsController.lastRenderTime, true);
      if (!this.scratch || this.scratch.canvas.width !== width || this.scratch.canvas.height !== height) {
        const scratch = document.createElement('canvas');
        scratch.width = width;
        scratch.height = height;
        this.scratch = scratch.getContext('2d', { willReadFrequently: true });
      }
      if (!this.scratch) throw new Error('No 2D context to read the canvas with');
      this.scratch.drawImage(canvas, 0, 0);
      return toLuminance(this.scratch.getImageData(0, 0, width, height).data, width, height);
    } finally {
      if (camera instanceof PerspectiveCamera) camera.clearViewOffset();
    }
  }

  /** Canvas row of the horizon: a point 50 km ahead on the water, projected. */
  private horizonRow(): number {
    const camera = this.engine.camera;
    const height = this.engine.canvas.height;
    const forward = camera.getWorldDirection(new Vector3());
    forward.y = 0;
    if (forward.lengthSq() === 0) return 0;
    const far = camera.position.clone().addScaledVector(forward.normalize(), 50_000).setY(0);
    const ndc = far.project(camera);
    return Math.max(0, Math.min(height, Math.ceil(((1 - ndc.y) / 2) * height)));
  }

  private environment(): Readonly<Record<string, TestSetting>> {
    const renderer = this.engine.renderer as { isWebGPURenderer?: boolean };
    return {
      backend: renderer.isWebGPURenderer === true ? 'webgpu' : 'webgl',
      gpuVendor: this.gpuVendor,
      viewport: `${this.engine.renderer.domElement.width}x${this.engine.renderer.domElement.height}`,
    };
  }
}
