import { Component, DestroyRef, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AmbientLight, DirectionalLight, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { PlanetAtmosphereComponent, type IAtmosphereSurface } from 'triangular-engine/atmosphere';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { PlanetComponent, PlanetTerrainComponent, TerrainPlanetMaterial } from 'triangular-engine/lod-surface';
import { cellPlanetFor, createGroundSample, type Vec3 } from 'triangular-engine/lod-surface/core';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import { bakeInWorker } from '../lod-surface-lab/lod-height-bake-client';
import {
  PLANET_POSES, PLANET_RADIUS_M, groundUp, motionView, nearPlaneFor, planetPoseView, resolvePlanetCamera, sceneSunDirection,
  type PlanetMotion, type PlanetPoseId, type PlanetView,
} from './planet-camera';
import { createPlanetSceneTestAdapter, type PlanetSceneTestHost } from './planet-scene-test-adapter';
import { DEFAULT_PLANET_SCENE_SETTINGS, PLANET_SCENE_TEST_HISTORY, type PlanetSceneTestSettings } from './planet-scene-tests';

/**
 * Plan 059 step G5: the planet scene. `<planet>` with `<planetTerrain>` and `<planetAtmosphere>` inside it, written the way
 * a game writes it: the radius, the sun and the baked cell-planet world are given to the planet once, and the layers read them.
 * WebGPU only. Clouds are a placeholder (`<planetClouds>` has its own plan); the morph slider is bound to `<planet [morph]>`,
 * but the terrain does not bend until step G6 and says so.
 *
 * The camera stands in the scene frame (the planet's centre is the origin) and is placed every tick from a pose or a scripted
 * move; the terrain's `groundAt` keeps the eye above the drawn ground. Reversed float depth, so a 2 cm near plane and an orbit
 * view share a buffer.
 */

const FOV_DEG = 60;
const THUMBNAIL_WIDTH = 240;
/** Selection samples kept for the HUD's running mean. */
const HUD_SAMPLES = 60;
/** How long the page's own "play" buttons take for a scripted move, seconds. */
const PLAY_SECONDS: Readonly<Record<PlanetMotion, number>> = { descent: 14, yaw360: 12 };

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
  readonly info?: { render: { drawCalls: number; triangles: number } };
}

@Component({
  standalone: true,
  selector: 'app-planet-scene-page',
  imports: [EngineModule, RouterLink, TestRunnerComponent, PlanetComponent, PlanetTerrainComponent, PlanetAtmosphereComponent],
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
  template: `
    <scene>
      <planet [radius]="radius" [sunDirection]="sun" [world]="world" [bake]="bake" [morph]="morph()">
        @if (terrainOn()) {
          <planetTerrain />
        }
        <planetAtmosphere preset="earth" [surfaces]="surfaces()" [enabled]="atmosphereOn()" />
        <!-- Clouds: placeholder. <planetClouds> gets its own plan. -->
      </planet>
    </scene>

    @if (!webGpuOk()) {
      <div class="blocker" role="alert">
        <h2>WebGPU required</h2>
        <p>The planet scene draws with the WebGPU renderer only (Plan 059 D2). {{ webGpuReason() }}</p>
        <a routerLink="/">← Examples</a>
      </div>
    }

    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Planet scene · Plan 059 G5</h2>
      <p class="hud" data-testid="hud">
        {{ hud().backend }} · {{ hud().width }}×{{ hud().height }} · {{ hud().adapter }}
        @if (hud().software) { <b> · SOFTWARE RENDERER</b> }<br />
        @if (terrainOn()) {
          leaves {{ stats().leaves }} (drawn {{ stats().drawn }}) · {{ triangles() }} triangles<br />
          deepest level {{ stats().deepestLevel }}
          @if (stats().capHit) { · <b>cap hit, {{ stats().unmet }} unmet</b> }<br />
          selection {{ selectionMs().toFixed(2) }} ms ·
        } @else {
          terrain off ·
        }
        altitude {{ altitudeLabel() }}<br />
        {{ bakeLine() }}
      </p>

      <tri-test-runner
        [suites]="testHistory" [adapter]="testAdapter" [available]="runnerReady()"
        [allowAutoStart]="allowTestAutoStart" [resultSink]="true" (progressChange)="onTestProgress($event)" />
      <p class="note">Keep the tab visible and focused for timing. Headless or software runs are functional evidence only.</p>

      <fieldset class="controls" [disabled]="runnerBusy()">
        <p class="label">Camera pose</p>
        <p class="row">
          @for (item of poses; track item.id) {
            <button (click)="setPose(item.id)" [class.active]="!playing() && pose() === item.id">{{ item.label }}</button>
          }
        </p>
        <p class="label">Scripted moves</p>
        <p class="row">
          <button (click)="play('descent')" [class.active]="playing() === 'descent'" data-testid="play-descent">descent: orbit to the 2 m eye</button>
          <button (click)="play('yaw360')" [class.active]="playing() === 'yaw360'" data-testid="play-yaw">turn 360° at the eye</button>
        </p>

        <p class="label">Layers</p>
        <label class="feature">
          <input type="checkbox" [checked]="terrainOn()" (change)="setTerrain($any($event.target).checked)" />
          Terrain (switching it back on rebuilds its material: a second or two)
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="atmosphereOn()" (change)="setAtmosphere($any($event.target).checked)" />
          Atmosphere (sky, and lighting and haze on the terrain)
        </label>
        <p class="note">Atmosphere on the terrain: {{ surfaceLine() }}</p>
        <p class="note" data-testid="clouds">Clouds: placeholder; <code>&lt;planetClouds&gt;</code> gets its own plan.</p>

        <p class="row">morph {{ morph().toFixed(2) }}
          <input type="range" min="0" max="1" step="0.05" aria-label="Globe to map morph" [value]="morph()" (input)="setMorph(+$any($event.target).value)" />
        </p>
        @if (morphNotice()) {
          <p class="note warn" data-testid="morph-notice">{{ morphNotice() }}</p>
        }
      </fieldset>
      @if (errorLine()) {
        <p class="note warn" role="alert">{{ errorLine() }}</p>
      }
    </aside>
  `,
  styles: `
    :host { position: relative; }
    .panel {
      position: absolute; top: 1rem; left: 1rem; max-width: 360px; max-height: calc(100vh - 2rem); overflow-y: auto;
      background: rgba(10, 14, 20, 0.85); color: #eee; padding: 1rem; border-radius: 8px; font: 13px/1.4 system-ui; z-index: 20;
    }
    .panel h2 { margin: 0.3rem 0; font-size: 15px; }
    .panel input[type='range'] { width: 100%; }
    .hud { margin: 0.5rem 0; font: 12px/1.5 ui-monospace, monospace; }
    .controls { border: 0; padding: 0; margin: 0; min-width: 0; }
    .row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin: 0.3rem 0; }
    .label { margin: 0.6rem 0 0; opacity: 0.7; }
    .note { opacity: 0.7; margin: 0.4rem 0 0; }
    .warn { opacity: 1; color: #fc8; }
    .feature { display: block; margin: 0.2rem 0; }
    button.active { outline: 2px solid #6cf; }
    .blocker {
      position: absolute; inset: 0; z-index: 30; display: grid; place-content: center; gap: 0.5rem; padding: 2rem;
      background: rgba(5, 8, 12, 0.92); color: #eee; font: 15px/1.5 system-ui; text-align: center;
    }
  `,
})
export class PlanetScenePageComponent {
  private readonly engine = inject(EngineService);
  private readonly screenshot = inject(ScreenshotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly poses = PLANET_POSES;
  readonly testHistory = PLANET_SCENE_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();

  /** What `<planet>` is given, once. */
  readonly radius = PLANET_RADIUS_M;
  readonly sun = sceneSunDirection();
  readonly world = cellPlanetFor(PLANET_RADIUS_M);
  readonly bake = bakeInWorker;

  readonly pose = signal<PlanetPoseId>(DEFAULT_PLANET_SCENE_SETTINGS.pose);
  readonly terrainOn = signal(DEFAULT_PLANET_SCENE_SETTINGS.terrain);
  readonly atmosphereOn = signal(DEFAULT_PLANET_SCENE_SETTINGS.atmosphere);
  readonly morph = signal(DEFAULT_PLANET_SCENE_SETTINGS.morph);
  /** The page's own scripted move (the "play" buttons), or undefined. */
  readonly playing = signal<PlanetMotion | undefined>(undefined);

  private readonly planet = viewChild(PlanetComponent);
  private readonly terrainLayer = viewChild(PlanetTerrainComponent);
  private readonly atmosphereLayer = viewChild(PlanetAtmosphereComponent);

  /** The terrain's material when it is a surface the atmosphere can light and haze (a `TerrainPlanetMaterial` is). */
  private readonly terrainSurface = computed<IAtmosphereSurface | undefined>(() => {
    const material = this.terrainLayer()?.surface();
    return material instanceof TerrainPlanetMaterial ? material : undefined;
  });
  /** `<planetAtmosphere [surfaces]>`: the terrain's own material when there is one, else sky only. */
  readonly surfaces = computed<readonly IAtmosphereSurface[]>(() => {
    const surface = this.terrainSurface();
    return surface ? [surface] : [];
  });
  readonly surfaceLine = computed(() => {
    if (!this.terrainOn()) return 'no terrain';
    return this.terrainSurface() ? 'lighting and haze stages on the terrain material' : 'sky only (the terrain has no planet material yet)';
  });

  readonly webGpuOk = signal(typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu);
  readonly webGpuReason = signal(this.webGpuOk() ? '' : 'This browser exposes no navigator.gpu.');
  readonly runnerReady = signal(false);
  readonly runnerBusy = signal(false);
  readonly hud = signal({ backend: 'starting', width: 0, height: 0, adapter: 'adapter unknown', software: false });
  readonly stats = signal({ leaves: 0, drawn: 0, deepestLevel: 0, capHit: false, unmet: 0 });
  readonly selectionMs = signal(0);
  readonly altitudeLabel = signal('');
  readonly triangles = computed(() => this.triangleCount().toLocaleString('en-US'));
  private readonly triangleCount = signal(0);
  /** The terrain's one report that it draws the sphere while the morph is above 0 (shown, not a test error). */
  readonly morphNotice = signal('');
  readonly errorLine = signal('');
  readonly bakeLine = computed(() => {
    const planet = this.planet();
    if (!planet) return 'planet: starting';
    return planet.heights() ? 'heights: baked' : 'heights: baking the cell planet (terrain flat until it lands)';
  });

  private sunLight: DirectionalLight | undefined;
  private ambientLight: AmbientLight | undefined;
  private pageDestroyed = false;
  /** Progress (0..1) of the scripted move a test drives, or undefined when none runs. */
  private testProgress: number | undefined;
  private testMotion: PlanetMotion | undefined;
  private demo: { readonly motion: PlanetMotion; readonly began: number } | undefined;
  private renderedFrames = 0;
  private engineError = '';
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private readonly hudSamples: number[] = [];
  private selectionSamples: number[] = [];
  private leafSamples: number[] = [];
  private readonly renderCallbacks = new Set<(renderedAt: number) => void>();
  private readonly groundSample = createGroundSample();
  private readonly basis = new Matrix4();
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()] as const;

  private readonly testHost: PlanetSceneTestHost = {
    read: () => this.readSettings(),
    apply: (settings) => this.applySettings(settings),
    renderedFrames: () => this.renderedFrames,
    errors: () => this.engineError,
    resetErrors: () => { this.engineError = ''; },
    backendIsWebGpu: () => this.webGpuOk() && this.hud().backend === 'webgpu',
    pending: () => this.pending(),
    frame: () => {
      const body = this.terrainLayer()?.terrain();
      const stats = body?.stats;
      return {
        leaves: stats?.leaves ?? 0,
        drawnLeaves: stats?.drawn ?? 0,
        surfaceTriangles: body?.triangles ?? 0,
        deepestLevel: stats?.deepestLevel ?? 0,
        capHit: stats?.capHit ?? false,
        unmet: stats?.unmet ?? 0,
        leafCap: body?.settings.leafCap ?? 0,
        drawCalls: this.lastDrawCalls,
        rendererTriangles: this.lastTriangles,
        drawingBuffer: [this.hud().width, this.hud().height],
      };
    },
    onRenderComplete: (callback) => { this.renderCallbacks.add(callback); return () => this.renderCallbacks.delete(callback); },
    selectionSamples: () => this.selectionSamples,
    leafSamples: () => this.leafSamples,
    resetSamples: () => { this.selectionSamples = []; this.leafSamples = []; },
    setMotionProgress: (t) => { this.testProgress = t; },
    isSampling: () => this.engine.fpsController.frameSampler.isActive,
    startSampling: () => this.engine.fpsController.frameSampler.start(),
    gpuSamplesSoFar: () => this.engine.fpsController.frameSampler.gpuSamples,
    stopSampling: () => this.engine.fpsController.frameSampler.stop(),
    environment: () => this.environment(),
    thumbnail: () => this.screenshot.capture({
      engine: this.engine, format: 'image/webp', quality: 0.6,
      compress: { maxWidthOrHeight: THUMBNAIL_WIDTH, fileType: 'image/webp', quality: 0.6 },
    }),
  };
  readonly testAdapter: TestRunAdapter<PlanetSceneTestSettings, PlanetSceneTestSettings> = createPlanetSceneTestAdapter(this.testHost);

  constructor() {
    const errors = this.engine.error$.subscribe((event) => {
      if (event.phase === 'morph') {
        // The terrain's one-time "I draw the sphere until G6" report: a fact of this step, not a failure of a run.
        this.morphNotice.set(event.error instanceof Error ? event.error.message : String(event.error));
        return;
      }
      const line = `${event.phase}: ${String(event.error)}`;
      this.engineError ||= line;
      this.errorLine.set(line);
    });
    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) camera.fov = FOV_DEG;
    // The terrain's PBR material is lit by scene lights; the sun light follows the planet's sun.
    this.sunLight = new DirectionalLight(0xffffff, 3);
    this.sunLight.position.set(this.sun[0], this.sun[1], this.sun[2]);
    this.ambientLight = new AmbientLight(0xaabbdd, 0.5);
    this.engine.scene.add(this.sunLight, this.sunLight.target, this.ambientLight);

    const tick = this.engine.tick$.subscribe(() => this.update());
    const rendered = this.engine.renderComplete$.subscribe(({ renderedAt }) => {
      this.renderedFrames++;
      const renderer = this.engine.renderer as unknown as RendererLike;
      this.lastDrawCalls = renderer.info?.render.drawCalls ?? 0;
      this.lastTriangles = renderer.info?.render.triangles ?? 0;
      const body = this.terrainLayer()?.terrain();
      if (body && this.engine.fpsController.frameSampler.isActive) {
        this.selectionSamples.push(body.selectionMs);
        this.leafSamples.push(body.stats.leaves);
      }
      if (this.renderedFrames % 30 === 1) this.refreshHud(renderer);
      for (const callback of this.renderCallbacks) callback(renderedAt);
    });
    this.destroyRef.onDestroy(() => {
      this.pageDestroyed = true;
      this.runnerReady.set(false);
      errors.unsubscribe();
      tick.unsubscribe();
      rendered.unsubscribe();
      if (this.sunLight && this.ambientLight) this.engine.scene.remove(this.sunLight, this.sunLight.target, this.ambientLight);
      this.sunLight = this.ambientLight = undefined;
    });
  }

  setPose(id: PlanetPoseId): void {
    this.demo = undefined;
    this.playing.set(undefined);
    this.pose.set(id);
  }

  play(motion: PlanetMotion): void {
    if (this.runnerBusy()) return;
    this.demo = { motion, began: performance.now() };
    this.playing.set(motion);
  }

  setTerrain(on: boolean): void { this.terrainOn.set(on); }
  setAtmosphere(on: boolean): void { this.atmosphereOn.set(on); }
  setMorph(value: number): void { this.morph.set(Math.min(1, Math.max(0, value))); }

  onTestProgress(progress: TestProgress | null): void {
    this.runnerBusy.set(progress !== null);
    if (progress !== null) {
      this.demo = undefined;
      this.playing.set(undefined);
    }
  }

  private readSettings(): PlanetSceneTestSettings {
    return {
      pose: this.pose(), terrain: this.terrainOn(), atmosphere: this.atmosphereOn(), morph: this.morph(),
      ...(this.testProgress !== undefined && this.testMotion ? { motion: this.testMotion } : {}),
    };
  }

  private applySettings(settings: PlanetSceneTestSettings): void {
    this.demo = undefined;
    this.playing.set(undefined);
    this.terrainOn.set(settings.terrain);
    this.atmosphereOn.set(settings.atmosphere);
    this.morph.set(settings.morph);
    this.pose.set(settings.pose);
    this.testMotion = settings.motion;
    this.testProgress = settings.motion ? 0 : undefined;
  }

  /**
   * What the scene still waits for, or '' when the settings are fully on screen: the height bake, the terrain rebuilt with
   * those heights and its own material, its pipeline compiled (it is hidden until then), and the atmosphere built with the
   * terrain's material attached.
   */
  private pending(): string {
    if (!this.webGpuOk()) return '';
    const atmosphere = this.atmosphereLayer()?.atmosphere();
    if (!atmosphere) return 'the atmosphere tables';
    if (!this.terrainOn()) return '';
    const layer = this.terrainLayer();
    const body = layer?.terrain();
    if (!layer || !body) return 'the terrain';
    const heights = this.planet()?.heights();
    if (!heights) return 'the height bake';
    if (body.settings.heights !== heights) return 'the terrain to take the baked heights';
    const surface = layer.surface();
    if (surface && body.settings.material !== surface) return "the terrain to take the planet's material";
    if (!body.object.visible) return "the terrain's pipeline";
    const attachable = this.terrainSurface();
    if (attachable && !atmosphere.hasSurface(attachable)) return 'the atmosphere to reach the terrain';
    return '';
  }

  private currentView(): PlanetView {
    if (this.testProgress !== undefined && this.testMotion) return motionView(this.testMotion, this.testProgress);
    const demo = this.demo;
    if (demo) {
      const t = (performance.now() - demo.began) / (PLAY_SECONDS[demo.motion] * 1000);
      if (t < 1) return motionView(demo.motion, t);
      // The move ends where it ends: the eye pose it finishes on, then the buttons are free again.
      this.demo = undefined;
      this.playing.set(undefined);
      this.pose.set(demo.motion === 'descent' ? 'ground' : 'ground');
    }
    return planetPoseView(this.pose());
  }

  /** Every tick: place the camera on the view, with the eye kept above the drawn ground. The terrain selects in `beforeRender$`. */
  private update(): void {
    const view = this.currentView();
    const up = groundUp(view);
    const layer = this.terrainLayer();
    let groundHeight = 0;
    if (layer && this.terrainOn()) {
      const sample = layer.groundAt([up[0] * PLANET_RADIUS_M, up[1] * PLANET_RADIUS_M, up[2] * PLANET_RADIUS_M] as Vec3, this.groundSample);
      if (sample) groundHeight = sample.heightM;
    }
    const camera = resolvePlanetCamera(view, PLANET_RADIUS_M, groundHeight);
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

    const body = layer?.terrain();
    if (body && this.renderedFrames % 15 === 0) {
      this.stats.set({ leaves: body.stats.leaves, drawn: body.stats.drawn, deepestLevel: body.stats.deepestLevel, capHit: body.stats.capHit, unmet: body.stats.unmet });
      this.triangleCount.set(body.triangles);
      this.hudSamples.push(body.selectionMs);
      if (this.hudSamples.length > HUD_SAMPLES) this.hudSamples.shift();
      this.selectionMs.set(this.hudSamples.reduce((a, b) => a + b, 0) / this.hudSamples.length);
    }
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
      'planet.world': `cell planet seed ${this.world.seed}, ${this.world.cellCount} cells, ${this.world.heightScaleM} m per unit`,
      'surface.material': 'terrain-planet',
      clouds: 'placeholder',
    };
  }

  private refreshHud(renderer: RendererLike): void {
    const environment = this.environment();
    const backend = String(environment['backend']);
    const adapter = ['gpu.vendor', 'gpu.architecture', 'gpu.device']
      .map((key) => environment[key])
      .filter((part) => part && part !== 'unknown')
      .join(' / ') || 'adapter reported nothing';
    this.hud.set({
      backend, adapter, software: environment['gpu.software'] === true,
      width: renderer.domElement?.width ?? 0, height: renderer.domElement?.height ?? 0,
    });
    if (backend !== 'webgpu' && this.webGpuOk() && backend !== 'none') {
      this.webGpuOk.set(false);
      this.webGpuReason.set(`The renderer started on ${backend} instead.`);
    }
    this.runnerReady.set(!this.pageDestroyed && this.webGpuOk() && backend === 'webgpu' && this.renderedFrames > 3);
  }
}
