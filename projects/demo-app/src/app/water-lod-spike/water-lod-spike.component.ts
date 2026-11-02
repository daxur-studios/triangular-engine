import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  isDevMode,
  signal,
  viewChild,
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
import {
  COVER_MARGIN_M,
  auditShore,
  auditShoreLook,
  createLandCoverHook,
  createWaterLodSpikeLand,
  measureLeaves,
  waterCeilingM,
  type ILeafCull,
  type IShoreAudit,
  type IShoreLookAudit,
} from './core/water-lod-spike-land';
import { runWaterLodSpikePrecisionProbe, type IPrecisionProbeRenderer } from './core/water-lod-spike-precision-probe';
import { WATER_LOD_SPIKE_QUALITIES, waterLodSpikeQuality, type WaterLodSpikeQualityId } from './core/water-lod-spike-quality';
import { WATER_LOD_SPIKE_UNIFORMS, shoreLookAt } from './core/water-lod-spike-waves';
import {
  createWaterLodSpikeTestAdapter,
  WATER_LOD_SPIKE_TEST_HISTORY,
  type WaterLodSpikeTestSettings,
  type WaterLodSpikeView,
} from './water-lod-spike-tests';

/** The crescent gate's grid: a 5 km square around the origin at 25 m (the islands near the origin and their shores). */
const AUDIT_HALF_M = 2_500;
const AUDIT_STEP_M = 25;

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

  /** Land under the water (Plan 080 w2 spike): islands from `core/water-lod-spike-land.ts`, drawn as a second body. Off by default. */
  readonly land = signal(false);
  protected readonly landHeights = createWaterLodSpikeLand();
  private readonly waterBody = viewChild<FlatTerrainComponent>('waterBody');
  private readonly landBody = viewChild<FlatTerrainComponent>('landBody');
  private savedLand: boolean | null = null;
  /**
   * The library cover hook on the water body (Plan 080 w2): water leaves entirely under the land are not drawn and take no leaf
   * budget. Only acts while the land is on. Off by default so the page keeps showing what the selector does without it.
   */
  readonly cull = signal(false);
  private readonly coverHook = createLandCoverHook();
  private savedCull: boolean | null = null;

  /** The terrain default for detail noise (a share of the texel). The water body carried it unasked until the shoreline review. */
  protected readonly defaultDetailNoise = 0.04;
  /**
   * The water body's detail noise on or off. On is the terrain default, which at 100 km over 1,024 texels is about 4 m of lumpy
   * height on the water and widens the body's height bound. Off by default since the shoreline review: the water has its own
   * waves, and the noise is not scaled by the shore weight, so it still stands above the land at the shore.
   */
  readonly waterNoise = signal(false);
  private savedWaterNoise: boolean | null = null;
  /**
   * Waves scaled by `smoothstep(0, ramp, D)` of the water depth D over the land (Plan 080 shoreline review): the waterline is
   * where the land crosses the sea level and no crest stands above the land. Acts only while the land is on.
   */
  readonly shore = signal(true);
  private savedShore: boolean | null = null;
  /** Foam at the waterline and breaker lines, from the water depth D (Plan 080 shoreline review, experiment 4). Acts only while the land is on. */
  readonly foam = signal(true);
  private savedFoam: boolean | null = null;
  /** Water colour from shallow to deep with D. Acts only while the land is on. */
  readonly depthColour = signal(true);
  private savedDepthColour: boolean | null = null;

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
    this.engine.scene.background = new Color('#12181f');    this.water = createWaterLodSpikeScene(this.engine, (diagnostics) => {
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
      // The land draws first so its depth rejects the water under it early (a group's order applies to its children).
      const landObject = this.landBody()?.terrain()?.object;
      if (landObject && landObject.renderOrder !== -1) landObject.renderOrder = -1;
      this.syncCover();
      WATER_LOD_SPIKE_UNIFORMS.shore.value = this.shore() && this.land() ? 1 : 0;
      WATER_LOD_SPIKE_UNIFORMS.foam.value = this.foam() && this.land() ? 1 : 0;
      WATER_LOD_SPIKE_UNIFORMS.depthColour.value = this.depthColour() && this.land() ? 1 : 0;
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
      setLand: (enabled) => this.holdLand(enabled),
      landDrawn: () => this.landBody()?.terrain()?.object.visible === true,
      landLeaves: (cover) => this.landLeaves('drawn', cover === true),
      landAudit: () => this.landLeaves('all', true),
      setCull: (enabled) => this.holdCull(enabled),
      setWaterNoise: (enabled) => this.holdWaterNoise(enabled),
      setShore: (enabled) => this.holdShore(enabled),
      shoreAudit: (times) => this.auditShoreOverTime(times),
      setFoam: (enabled) => this.holdFoam(enabled),
      setDepthColour: (enabled) => this.holdDepthColour(enabled),
      shoreLookAudit: () => this.auditShoreLookNow(),
      coverActive: () => this.waterBody()?.terrain()?.selector.cover !== undefined,
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

  toggleLand(): void {
    this.land.update((enabled) => !enabled);
  }

  /** Puts the land on or off for a test case (null restores the page's own setting). */
  private holdLand(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedLand ??= this.land();
      this.land.set(enabled);
      return;
    }
    if (this.savedLand !== null) this.land.set(this.savedLand);
    this.savedLand = null;
  }

  /**
   * The drawn leaves of the water body's last selection judged against the land (see `measureLeaves`). The ceiling is the
   * body's own global height bound, waves and detail noise included, as a library cull hook would read it.
   */
  private landLeaves(scope: 'drawn' | 'all', cover: boolean): ILeafCull {
    const body = this.waterBody()?.terrain();
    if (!body) throw new Error('The water body does not exist yet');
    const selector = body.selector;
    // With the cover margin the judgement is the hook's own: land must clear the water's bound by the margin.
    return measureLeaves(selector, selector.settings.domain, waterCeilingM(selector.settings.heightBoundM, cover ? COVER_MARGIN_M : 0), undefined, scope);
  }

  toggleWaterNoise(): void {
    this.waterNoise.update((enabled) => !enabled);
  }

  /** Puts the water's detail noise on or off for a test case (null restores the page's own setting). */
  private holdWaterNoise(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedWaterNoise ??= this.waterNoise();
      this.waterNoise.set(enabled);
      return;
    }
    if (this.savedWaterNoise !== null) this.waterNoise.set(this.savedWaterNoise);
    this.savedWaterNoise = null;
  }

  toggleShore(): void {
    this.shore.update((enabled) => !enabled);
  }

  /** Puts the shore weight on or off for a test case (null restores the page's own setting). */
  private holdShore(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedShore ??= this.shore();
      this.shore.set(enabled);
      return;
    }
    if (this.savedShore !== null) this.shore.set(this.savedShore);
    this.savedShore = null;
  }

  /**
   * The crescent gate over the water body's own surface (waves at the given times, detail noise included, shore weight as set)
   * against the land: dry points where the water stands above the land. Worst case over the times.
   */
  private auditShoreOverTime(times: readonly number[]): IShoreAudit {
    const source = this.waterBody()?.terrain()?.source;
    if (!source) throw new Error('The water body does not exist yet');
    const savedTime = WATER_LOD_SPIKE_UNIFORMS.time.value as number;
    // The shore weight reads the land, which the uniform follows from the page's tick; the audit needs it now.
    const savedShore = WATER_LOD_SPIKE_UNIFORMS.shore.value as number;
    WATER_LOD_SPIKE_UNIFORMS.shore.value = this.shore() ? 1 : 0;
    try {
      let worst: IShoreAudit = { dryPoints: 0, violations: 0, maxExcessM: 0, meanExcessM: 0 };
      let violations = 0;
      for (const t of times) {
        WATER_LOD_SPIKE_UNIFORMS.time.value = t;
        const audit = auditShore((x, z) => source.heightAt(x, 0, z), AUDIT_HALF_M, AUDIT_STEP_M);
        violations += audit.violations;
        if (audit.maxExcessM >= worst.maxExcessM) worst = audit;
      }
      return { ...worst, violations: Math.round(violations / times.length) };
    } finally {
      WATER_LOD_SPIKE_UNIFORMS.time.value = savedTime;
      WATER_LOD_SPIKE_UNIFORMS.shore.value = savedShore;
    }
  }

  toggleFoam(): void {
    this.foam.update((enabled) => !enabled);
  }

  toggleDepthColour(): void {
    this.depthColour.update((enabled) => !enabled);
  }

  /** Puts the foam on or off for a test case (null restores the page's own setting). The uniform follows at once, so a frame read next shows it. */
  private holdFoam(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedFoam ??= this.foam();
      this.foam.set(enabled);
    } else {
      if (this.savedFoam !== null) this.foam.set(this.savedFoam);
      this.savedFoam = null;
    }
    WATER_LOD_SPIKE_UNIFORMS.foam.value = this.foam() && this.land() ? 1 : 0;
  }

  /** Puts the depth colour on or off for a test case (null restores the page's own setting). */
  private holdDepthColour(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedDepthColour ??= this.depthColour();
      this.depthColour.set(enabled);
    } else {
      if (this.savedDepthColour !== null) this.depthColour.set(this.savedDepthColour);
      this.savedDepthColour = null;
    }
    WATER_LOD_SPIKE_UNIFORMS.depthColour.value = this.depthColour() && this.land() ? 1 : 0;
  }

  /** The shore look gate over the 5 km grid with both looks on (the page's uniforms for the look's scales), judged against the land. */
  private auditShoreLookNow(): IShoreLookAudit {
    const savedFoam = WATER_LOD_SPIKE_UNIFORMS.foam.value as number;
    const savedColour = WATER_LOD_SPIKE_UNIFORMS.depthColour.value as number;
    WATER_LOD_SPIKE_UNIFORMS.foam.value = 1;
    WATER_LOD_SPIKE_UNIFORMS.depthColour.value = 1;
    try {
      return auditShoreLook(shoreLookAt, AUDIT_HALF_M, AUDIT_STEP_M, {
        edgeM: WATER_LOD_SPIKE_UNIFORMS.foamEdgeM.value as number,
        zoneM: WATER_LOD_SPIKE_UNIFORMS.foamZoneM.value as number,
        spacingM: WATER_LOD_SPIKE_UNIFORMS.foamSpacingM.value as number,
        speedMS: WATER_LOD_SPIKE_UNIFORMS.foamSpeedMS.value as number,
        tintScaleM: WATER_LOD_SPIKE_UNIFORMS.tintScaleM.value as number,
      });
    } finally {
      WATER_LOD_SPIKE_UNIFORMS.foam.value = savedFoam;
      WATER_LOD_SPIKE_UNIFORMS.depthColour.value = savedColour;
    }
  }

  toggleCull(): void {
    this.cull.update((enabled) => !enabled);
  }

  /** Puts the cover hook on or off for a test case (null restores the page's own setting). */
  private holdCull(enabled: boolean | null): void {
    if (enabled !== null) {
      this.savedCull ??= this.cull();
      this.cull.set(enabled);
      return;
    }
    if (this.savedCull !== null) this.cull.set(this.savedCull);
    this.savedCull = null;
  }

  /** Installs or removes the cover hook on the water body so it matches the Cull and Land buttons; the body keeps it across rebuilds. */
  private syncCover(): void {
    const body = this.waterBody()?.terrain();
    if (!body) return;
    const wanted = this.cull() && this.land() ? this.coverHook : undefined;
    if (body.selector.cover !== wanted) body.setCoverHook(wanted);
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
