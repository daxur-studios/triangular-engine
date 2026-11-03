import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { Color, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { PlanetAtmosphereComponent, type IAtmosphereSurface } from 'triangular-engine/atmosphere';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { PlanetTerrainComponent } from 'triangular-engine/lod-surface';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import {
  PLANET_RADIUS_M, freeDrag, freeLook, freeZoom, groundUp, nearPlaneFor, resolvePlanetCamera, sceneSunDirection, type PlanetView,
} from '../pages/planet-scene/planet-camera';
import { createWaterLodSpikeSphereScene, type IWaterLodSpikeSphereSceneHandle } from './core/create-water-lod-spike-sphere-scene';
import { WATER_LOD_SPIKE_QUALITIES, waterLodSpikeQuality, type WaterLodSpikeQualityId } from './core/water-lod-spike-quality';
import { SPHERE_POSES, spherePoseView, type SpherePoseId } from './core/water-lod-spike-sphere-poses';
import { WATER_SPHERE_RADIUS_M, sphereLandHeightM } from './core/water-lod-spike-sphere-land';
import { sphereWaterHeightM } from './core/water-lod-spike-sphere-waves';
import {
  createWaterLodSpikeSphereTestAdapter,
  WATER_LOD_SPIKE_SPHERE_TEST_HISTORY,
  type IWaterLodSpikeSphereLayers,
  type WaterLodSpikeSphereTestSettings,
} from './water-lod-spike-sphere-tests';

const FOV_DEG = 60;
const THUMBNAIL_WIDTH_PX = 480;
const SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

interface RendererLike {
  readonly backend?: {
    readonly isWebGPUBackend?: boolean;
    readonly device?: {
      readonly adapterInfo?: Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>> & { readonly isFallbackAdapter?: boolean };
      readonly features?: { has(name: string): boolean };
    };
  };
  readonly domElement?: { readonly width: number; readonly height: number };
}

/**
 * Plan 080, water on a planet (stage A): the plane spike's water on a 600 km sphere, with the plane spike's islands for land and,
 * optionally, the planet atmosphere. Does the same water look right on a sphere, next to terrain and atmosphere, and does the whole
 * stack stay inside a frame budget?
 *
 * The water and the land are two standalone `<planetTerrain>` bodies (no `<planet>`), the atmosphere is a standalone
 * `<planetAtmosphere>`. The camera stands in the scene frame (the planet's centre is the origin), placed every tick from a pose or
 * from the mouse orbit, with the eye kept above the land and the swell.
 *
 * What it does not do yet (listed in ER 080): the water is not an atmosphere surface (it gets the sky backdrop but no haze or
 * light colour from the atmosphere), the vertex phase is float32 (millimetres on the geometry), and there is no cover hook or
 * shore audit on the sphere.
 */
@Component({
  selector: 'app-water-lod-spike-sphere',
  imports: [EngineModule, PlanetTerrainComponent, PlanetAtmosphereComponent, TestRunnerComponent],
  templateUrl: './water-lod-spike-sphere.component.html',
  styleUrl: './water-lod-spike-sphere.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      gpuTiming: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, trackTimestamp: true, reversedDepthBuffer: true },
    }),
    provideBrowserImageCompression(),
  ],
  host: { class: 'flex-page' },
})
export class WaterLodSpikeSphereComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly screenshot = inject(ScreenshotService);

  protected readonly radius = WATER_SPHERE_RADIUS_M;
  protected readonly sun = sceneSunDirection();
  protected readonly rig: IWaterLodSpikeSphereSceneHandle;
  protected readonly poses = SPHERE_POSES;
  protected readonly qualities = WATER_LOD_SPIKE_QUALITIES;

  readonly testHistory = WATER_LOD_SPIKE_SPHERE_TEST_HISTORY;
  /** Autostart from a launch link is a dev-only convenience; the owner's dev server is in dev mode. */
  readonly allowTestAutoStart = isDevMode();
  readonly testAdapter: TestRunAdapter<WaterLodSpikeSphereTestSettings, boolean>;

  readonly pose = signal<SpherePoseId>('coast-300m');
  readonly waterOn = signal(true);
  readonly landOn = signal(true);
  readonly atmosphereOn = signal(false);
  /** The atmosphere's relight and aerial haze on the land, separately (diagnostic: which of them changes the land's look). */
  readonly atmosphereLighting = signal(true);
  readonly atmosphereHaze = signal(true);
  readonly wireframe = signal(false);
  readonly filter = signal(true);
  readonly animating = signal(true);
  readonly shore = signal(true);
  readonly foam = signal(true);
  readonly depthColour = signal(true);
  readonly quality = signal<WaterLodSpikeQualityId>('ultra');
  /** Mouse orbit: the canvas drags, looks and zooms the camera. Off by default. */
  readonly freeOn = signal(false);
  protected readonly qualityTier = computed(() => waterLodSpikeQuality(this.quality()));
  protected readonly qualityIndex = computed(() => WATER_LOD_SPIKE_QUALITIES.findIndex((tier) => tier.id === this.quality()));
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  readonly altitudeLabel = signal('');
  readonly hud = signal({ backend: 'starting', width: 0, height: 0, adapter: 'adapter unknown', software: false });
  readonly runnerReady = signal(false);
  /** True while a test case is measuring or warming up; drives the red outline on the scene. */
  readonly testing = signal(false);
  readonly webGpuOk = signal(typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu);

  private readonly waterBody = viewChild<PlanetTerrainComponent>('waterBody');
  private readonly landBody = viewChild<PlanetTerrainComponent>('landBody');
  /** The land's material when the land is on: the atmosphere lights and hazes it. The water is not an atmosphere surface (yet). */
  protected readonly surfaces = computed<readonly IAtmosphereSurface[]>(() => (this.landOn() ? [this.rig.landMaterial] : []));

  /** A test case's holds; null while the page's own settings stand. */
  private readonly heldPose = signal<SpherePoseId | null>(null);
  private savedLayers: IWaterLodSpikeSphereLayers | null = null;

  private renderedFrames = 0;
  private frameTimes: number[] | null = null;
  private cpuTimes: number[] | null = null;
  private lastFrameMs = 0;
  private pageDestroyed = false;
  private readonly basis = new Matrix4();
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()] as const;
  /** The view mouse orbit edits while it is on; undefined otherwise. */
  private freeView: PlanetView | undefined;
  private freeCanvas: HTMLCanvasElement | undefined;
  private freeGesture: { readonly pointerId: number; x: number; y: number; readonly look: boolean } | undefined;

  private readonly onFreePointerDown = (event: PointerEvent): void => {
    if ((event.button !== 0 && event.button !== 2) || !this.freeCanvas) return;
    this.freeGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, look: event.button === 2 || event.shiftKey };
    this.freeCanvas.setPointerCapture(event.pointerId);
  };

  private readonly onFreePointerMove = (event: PointerEvent): void => {
    const gesture = this.freeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || !this.freeView || !this.freeCanvas) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const height = this.freeCanvas.clientHeight || 1;
    this.freeView = gesture.look ? freeLook(this.freeView, dx, dy, height, FOV_DEG) : freeDrag(this.freeView, dx, dy, height, FOV_DEG);
  };

  private readonly onFreePointerUp = (event: PointerEvent): void => {
    if (this.freeGesture?.pointerId === event.pointerId) this.freeGesture = undefined;
  };

  private readonly onFreeWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.freeView) this.freeView = freeZoom(this.freeView, event.deltaY);
  };

  private readonly onFreeContextMenu = (event: Event): void => event.preventDefault();

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) camera.fov = FOV_DEG;
    this.rig = createWaterLodSpikeSphereScene(this.engine, this.sun, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
    });
    this.destroyRef.onDestroy(() => this.rig.dispose());

    const tick = this.engine.tick$.subscribe(() => this.update());
    const rendered = this.engine.renderComplete$.subscribe(() => {
      this.renderedFrames++;
      if (this.renderedFrames % 30 === 1) this.refreshHud();
    });
    this.destroyRef.onDestroy(() => {
      this.pageDestroyed = true;
      this.runnerReady.set(false);
      this.detachFreeListeners();
      tick.unsubscribe();
      rendered.unsubscribe();
    });

    this.testAdapter = createWaterLodSpikeSphereTestAdapter({
      ready: () => this.runnerReady(),
      setPose: (id) => this.heldPose.set(id),
      setLayers: (layers) => this.holdLayers(layers),
      drawn: () => ({
        land: this.landOn() && this.landBody()?.terrain()?.object.visible === true,
        water: this.waterOn() && this.waterBody()?.terrain()?.object.visible === true,
        atmosphere: this.atmosphereOn(),
      }),
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
      waitFrames: async (count, context) => {
        const start = this.renderedFrames;
        while (this.renderedFrames < start + count) await context.wait(16);
      },
      environment: () => this.environment(),
      thumbnail: () => this.screenshot.capture({
        engine: this.engine, format: 'image/webp', quality: 0.6,
        compress: { maxWidthOrHeight: THUMBNAIL_WIDTH_PX, fileType: 'image/webp', quality: 0.6 },
      }),
    });
    this.rig.setShore(true);
    this.rig.setFoam(true);
    this.rig.setDepthColour(true);
    if (isDevMode()) this.installDevHook();
  }

  /**
   * Dev mode only: `window.__waterLodSphere` for scripted stills. `set` puts a pose and the layer toggles, `capture` renders a PNG of the
   * canvas and POSTs it to a local receiver (`http://127.0.0.1:<port>/<name>.png`), so the picture never has to pass through a chat.
   */
  private installDevHook(): void {
    const hook = {
      set: (state: { pose?: SpherePoseId; land?: boolean; water?: boolean; atmosphere?: boolean; light?: boolean; haze?: boolean; animate?: boolean; time?: number; quality?: WaterLodSpikeQualityId }) => {
        if (state.light !== undefined) this.atmosphereLighting.set(state.light);
        if (state.haze !== undefined) this.atmosphereHaze.set(state.haze);
        if (state.pose) this.setPose(state.pose);
        if (state.land !== undefined) this.landOn.set(state.land);
        if (state.water !== undefined) this.waterOn.set(state.water);
        if (state.atmosphere !== undefined) this.atmosphereOn.set(state.atmosphere);
        if (state.animate !== undefined) { this.animating.set(state.animate); this.rig.setAnimating(state.animate); }
        if (state.time !== undefined) this.rig.setTime(state.time);
        if (state.quality) this.setQuality(state.quality);
      },
      probe: () => {
        const land = this.landBody()?.terrain();
        const water = this.waterBody()?.terrain();
        return {
          land: land ? { visible: land.object.visible, triangles: land.triangles } : null,
          water: water ? { visible: water.object.visible, triangles: water.triangles } : null,
          drawCalls: this.drawCalls(), triangles: this.triangles(),
        };
      },
      capture: async (name: string, port = 47123) => {
        const blob = await this.screenshot.capture({ engine: this.engine, format: 'image/png' });
        const response = await fetch(`http://127.0.0.1:${port}/${encodeURIComponent(name)}.png`, { method: 'POST', body: blob });
        return response.status;
      },
    };
    (globalThis as unknown as { __waterLodSphere?: typeof hook }).__waterLodSphere = hook;
    this.destroyRef.onDestroy(() => { delete (globalThis as unknown as { __waterLodSphere?: typeof hook }).__waterLodSphere; });
  }

  onTestProgress(progress: TestProgress | null): void {
    this.testing.set(progress?.phase === 'measuring' || progress?.phase === 'warmup');
    if (progress !== null) this.setFreeOrbit(false);
  }

  setPose(id: SpherePoseId): void {
    this.setFreeOrbit(false);
    this.pose.set(id);
  }

  /** Mouse orbit on: the camera keeps the view it has now and the canvas drags (left button: spin the planet; shift or right button: look), the wheel zooms. Off: back to the pose. */
  setFreeOrbit(on: boolean): void {
    if (on) {
      this.freeView = this.currentView();
      this.freeOn.set(true);
      this.attachFreeListeners();
    } else {
      this.freeView = undefined;
      this.freeOn.set(false);
      this.detachFreeListeners();
    }
  }

  toggleWater(): void { this.waterOn.update((on) => !on); }
  toggleLand(): void { this.landOn.update((on) => !on); }
  toggleAtmosphere(): void { this.atmosphereOn.update((on) => !on); }
  toggleShore(): void { this.shore.update((on) => !on); }
  toggleFoam(): void { this.foam.update((on) => !on); }
  toggleDepthColour(): void { this.depthColour.update((on) => !on); }

  toggleWireframe(): void {
    this.wireframe.update((on) => !on);
    this.rig.setWireframe(this.wireframe());
  }

  toggleFilter(): void {
    this.filter.update((on) => !on);
    this.rig.setFilter(this.filter());
  }

  toggleAnimating(): void {
    this.animating.update((on) => !on);
    this.rig.setAnimating(this.animating());
  }

  /** Picks a quality tier from the slider (an index into the tiers, best first). */
  onQualitySlider(event: Event): void {
    const tier = WATER_LOD_SPIKE_QUALITIES[Number((event.target as HTMLInputElement).value)];
    if (tier) this.setQuality(tier.id);
  }

  setQuality(id: WaterLodSpikeQualityId): void {
    this.rig.setQuality(id);
    this.quality.set(id);
  }

  /** Puts the layers as a test case asks (null restores what the page had). */
  private holdLayers(layers: IWaterLodSpikeSphereLayers | null): void {
    if (layers) {
      this.savedLayers ??= { land: this.landOn(), water: this.waterOn(), atmosphere: this.atmosphereOn() };
      this.landOn.set(layers.land);
      this.waterOn.set(layers.water);
      this.atmosphereOn.set(layers.atmosphere);
      return;
    }
    if (this.savedLayers) {
      this.landOn.set(this.savedLayers.land);
      this.waterOn.set(this.savedLayers.water);
      this.atmosphereOn.set(this.savedLayers.atmosphere);
    }
    this.savedLayers = null;
  }

  private attachFreeListeners(): void {
    if (this.freeCanvas || this.pageDestroyed) return;
    const canvas = this.engine.renderer?.domElement;
    if (!canvas) return;
    this.freeCanvas = canvas;
    canvas.addEventListener('pointerdown', this.onFreePointerDown);
    canvas.addEventListener('pointermove', this.onFreePointerMove);
    canvas.addEventListener('pointerup', this.onFreePointerUp);
    canvas.addEventListener('pointercancel', this.onFreePointerUp);
    canvas.addEventListener('wheel', this.onFreeWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onFreeContextMenu);
  }

  private detachFreeListeners(): void {
    const canvas = this.freeCanvas;
    this.freeGesture = undefined;
    if (!canvas) return;
    canvas.removeEventListener('pointerdown', this.onFreePointerDown);
    canvas.removeEventListener('pointermove', this.onFreePointerMove);
    canvas.removeEventListener('pointerup', this.onFreePointerUp);
    canvas.removeEventListener('pointercancel', this.onFreePointerUp);
    canvas.removeEventListener('wheel', this.onFreeWheel);
    canvas.removeEventListener('contextmenu', this.onFreeContextMenu);
    this.freeCanvas = undefined;
  }

  private currentView(): PlanetView {
    if (this.freeOn() && this.freeView) return this.freeView;
    return spherePoseView(this.heldPose() ?? this.pose());
  }

  /** Every tick: the shared uniforms from the toggles, the land drawn first, and the camera placed on the view with the eye above the land and the swell. */
  private update(): void {
    if (this.freeOn()) this.attachFreeListeners();
    const rig = this.rig;
    const landOn = this.landOn();
    rig.setShore(this.shore() && landOn);
    rig.setFoam(this.foam() && landOn);
    rig.setDepthColour(this.depthColour() && landOn);

    const view = this.currentView();
    const up = groundUp(view);
    const base: [number, number, number] = [up[0] * PLANET_RADIUS_M, up[1] * PLANET_RADIUS_M, up[2] * PLANET_RADIUS_M];
    let surfaceM = 0;
    if (landOn) surfaceM = Math.max(surfaceM, sphereLandHeightM(...base));
    if (this.waterOn()) surfaceM = Math.max(surfaceM, sphereWaterHeightM(...base));
    const camera = resolvePlanetCamera(view, PLANET_RADIUS_M, surfaceM);
    const engineCamera = this.engine.camera;
    const [right, cameraUp, back] = this.axes;
    right.set(...camera.right);
    cameraUp.set(...camera.up);
    back.set(-camera.forward[0], -camera.forward[1], -camera.forward[2]);
    engineCamera.position.set(camera.position[0], camera.position[1], camera.position[2]);
    engineCamera.quaternion.setFromRotationMatrix(this.basis.makeBasis(right, cameraUp, back));
    if (engineCamera instanceof PerspectiveCamera) {
      const near = nearPlaneFor(camera.clearanceM);
      if (engineCamera.near !== near || engineCamera.far !== 1e9) {
        engineCamera.near = near;
        engineCamera.far = 1e9;
        engineCamera.updateProjectionMatrix();
      }
    }
    engineCamera.updateMatrixWorld();

    const nowMs = performance.now();
    if (this.frameTimes && this.lastFrameMs > 0) {
      this.frameTimes.push(nowMs - this.lastFrameMs);
      // The previous frame's tick-and-render time on the CPU, as the FPS panel shows it.
      this.cpuTimes?.push(this.engine.fpsController.cpuFrameTime());
    }
    this.lastFrameMs = nowMs;
    if (this.renderedFrames % 15 === 0) {
      const altitude = view.altitudeM;
      this.altitudeLabel.set(altitude >= 10_000 ? `${Math.round(altitude / 1000).toLocaleString('en-US')} km` : `${altitude.toFixed(1)} m`);
    }
  }

  private environment(): Record<string, TestSetting> {
    const renderer = this.engine.renderer as unknown as RendererLike;
    const backend = renderer.backend;
    const info = backend?.device?.adapterInfo;
    const describedBy = [info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ');
    return {
      backend: backend === undefined ? 'none' : backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
      ...describeRendererGpu(renderer),
      'gpu.software': info ? info.isFallbackAdapter === true || SOFTWARE.test(describedBy) : null,
      'gpu.timestampQuery': backend?.device?.features ? backend.device.features.has('timestamp-query') : null,
      'canvas.drawingBufferWidth': renderer.domElement?.width ?? 0,
      'canvas.drawingBufferHeight': renderer.domElement?.height ?? 0,
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      reversedDepthBuffer: true,
      'planet.radiusM': this.radius,
      'surface.material': 'terrain-planet (plain)',
      'water.material': 'sphere water (basic node material, sky backdrop only)',
    };
  }

  private refreshHud(): void {
    const renderer = this.engine.renderer as unknown as RendererLike;
    const environment = this.environment();
    const backend = String(environment['backend']);
    const adapter = ['gpu.vendor', 'gpu.architecture', 'gpu.device']
      .map((key) => environment[key])
      .filter((part) => part && part !== 'unknown')
      .join(' / ') || 'adapter reported nothing';
    this.hud.set({ backend, adapter, software: environment['gpu.software'] === true, width: renderer.domElement?.width ?? 0, height: renderer.domElement?.height ?? 0 });
    this.runnerReady.set(!this.pageDestroyed && this.webGpuOk() && backend === 'webgpu' && this.renderedFrames > 3);
  }
}
