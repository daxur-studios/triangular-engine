import { Component, DestroyRef, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AmbientLight, BoxGeometry, DirectionalLight, Matrix4, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { PlanetCloudsComponent } from 'triangular-engine/cloud-volumes';
import { PlanetAtmosphereComponent, type IAtmosphereSurface } from 'triangular-engine/atmosphere';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { checkerDebugLayer, PlanetSurfaceMaterial } from 'triangular-engine/planet-material';
import {
  PlanetComponent, PlanetSurfaceDetailComponent, PlanetTerrainComponent, TerrainPlanetMaterial, type PlanetSurfaceDetailLayer,
} from 'triangular-engine/lod-surface';
import { cellPlanetFor, createGroundSample, groundFrame, MorphMapResolver, type MorphMap, type Vec3 } from 'triangular-engine/lod-surface/core';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import { bakeInWorker } from '../lod-surface-lab/lod-height-bake-client';
import { createWaterLodSpikeSphereScene, type IWaterLodSpikeSphereSceneHandle } from '../../water-lod-spike/core/create-water-lod-spike-sphere-scene';
import { createWaterLodSpikeRecording } from '../../water-lod-spike/core/water-lod-spike-recording';
import { waterLodSpikeSphereQuality } from '../../water-lod-spike/core/water-lod-spike-quality';
import {
  PLANET_POSES, PLANET_RADIUS_M, REFERENCE_CUBES, referenceCubesFor, bendGlobePoint, bendPlanetCamera, bentDirection, freeDrag, freeLook, freeZoom,
  groundUp, motionMorph, motionView, nearPlaneFor, planetPoseView, referenceCubeGround, referenceCubeLift, resolvePlanetCamera,
  sceneSunDirection, type PlanetMotion, type PlanetPoseId, type PlanetView,
} from './planet-camera';
import { createPlanetSceneTestAdapter, type PlanetSceneTestHost } from './planet-scene-test-adapter';
import { DEFAULT_PLANET_SCENE_SETTINGS, PLANET_SCENE_RUNNER_SUITES, type PlanetSceneTestSettings } from './planet-scene-tests';

/**
 * Plan 059 step G5: the planet scene. `<planet>` with `<planetTerrain>` and `<planetAtmosphere>` inside it, written the way
 * a game writes it: the radius, the sun and the baked cell-planet world are given to the planet once, and the layers read them.
 * WebGPU only. The clouds are a far shell (`<planetClouds>`) whose vertices bend into the map with the morph. The morph
 * slider is bound to `<planet [morph]>`: the terrain, the cloud shell and the atmosphere's lighting and haze bend into the flat map; the sky backdrop still dissolves when the camera is high.
 *
 * The camera stands in the scene frame (the planet's centre is the origin) and is placed every tick from a pose or a scripted
 * move; the terrain's `groundAt` keeps the eye above the drawn ground. Reversed float depth, so a 2 cm near plane and an orbit
 * view share a buffer.
 */

const FOV_DEG = 60;
const THUMBNAIL_WIDTH = 240;
/** Selection samples kept for the HUD's running mean. */
const HUD_SAMPLES = 60;
/** The scripted moves the page's own "play" buttons run (the morph sweep is only run by a test). */
type DemoMotion = Exclude<PlanetMotion, 'morphSweep'>;
/** How long the page's own "play" buttons take for a scripted move, seconds. */
const PLAY_SECONDS: Readonly<Record<DemoMotion, number>> = { descent: 14, yaw360: 12 };

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
  imports: [
    EngineModule, RouterLink, TestRunnerComponent, PlanetComponent, PlanetTerrainComponent, PlanetSurfaceDetailComponent, PlanetAtmosphereComponent,
    PlanetCloudsComponent,
  ],
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
      <planet #planetBody [radius]="radiusM()" [sunDirection]="sun" [world]="world()" [bake]="bake" [morph]="morph()">
        @if (terrainOn()) {
          <planetTerrain #terrainBody [cull]="terrainCull()" [material]="plainMaterial() ? plainNode : undefined" />
        }
        <planetAtmosphere preset="earth" [surfaces]="surfaces()" [enabled]="atmosphereOn()" [sky]="skyOn()" [haze]="hazeOn()" [shellFade]="shellFadeOn()" />
        <planetClouds [coverage]="0.45" [enabled]="cloudsOn()" />
        <planetSurfaceDetail [surface]="detailSurface()" [layers]="detailLayers" />
      </planet>
      @if (waterOn() && waterRig(); as rig) {
        <!-- The water spike's body beside <planet>: it takes its own heights and material, so it cannot sit inside it. It
             shares the planet's morph uniforms (the same object) and radius, so it bends exactly with the ground. -->
        <planetTerrain
          #waterBody
          [radius]="radiusM()"
          [planetMorph]="planetBody.morphUniforms"
          [heights]="rig.heights"
          [material]="rig.material"
          [detailNoise]="0"
          [sunDirection]="sun"
          [cellPixels]="waterTier.cellPixels"
          [leafCap]="waterTier.leafCap"
          [horizonCull]="true"
        />
      }
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
        <label class="feature">
          <input type="checkbox" data-testid="free-orbit" [checked]="freeOn()" (change)="setFreeOrbit($any($event.target).checked)" />
          Mouse orbit: drag to spin the planet, shift or right-drag to look, wheel to zoom
        </label>
        <p class="row">
          @for (item of poses; track item.id) {
            <button (click)="setPose(item.id)" [class.active]="!playing() && !freeOn() && pose() === item.id">{{ item.label }}</button>
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
        <label class="feature">
          <input type="checkbox" data-testid="clouds-toggle" [checked]="cloudsOn()" (change)="setClouds($any($event.target).checked)" />
          Clouds (the shell)
        </label>
        <label class="feature">
          <input type="checkbox" data-testid="water-toggle" [checked]="waterOn()" (change)="setWater($any($event.target).checked)" />
          Water (the water spike's body, ultra tier, beside the planet; first use compiles its material)
        </label>
        <p class="note">Atmosphere on the terrain: {{ surfaceLine() }}</p>
        <p class="note" data-testid="clouds">Clouds: a shell (<code>&lt;planetClouds&gt;</code>) bent into the map with the morph (lit as on the globe). Not yet looked at on a GPU.</p>

        <label class="feature">
          <input type="checkbox" data-testid="follow-bend" [checked]="followBend()" (change)="followBend.set($any($event.target).checked)" />
          Camera follows the bend (keeps the same view of the ground through the morph)
        </label>
        <label class="feature">
          <input type="checkbox" data-testid="reference-cubes" [checked]="references()" (change)="references.set($any($event.target).checked)" />
          Reference cubes: 100 m (pink), 3 km (yellow), 100 km (cyan), ahead of the eye
        </label>
        <p class="row">morph {{ morph().toFixed(2) }}
          <input type="range" min="0" max="1" step="0.05" aria-label="Globe to map morph" [value]="morph()" (input)="setMorph(+$any($event.target).value)" />
        </p>
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
  readonly testHistory = PLANET_SCENE_RUNNER_SUITES;
  readonly allowTestAutoStart = isDevMode();

  /**
   * The planet's radius, metres (the ground-only ladder, suite `planet-ground-earth-*`, sets it per case). The planet restarts its
   * height bake when it changes, and `heights()` is undefined for the old radius from that moment.
   */
  readonly radiusM = signal(PLANET_RADIUS_M);
  readonly sun = sceneSunDirection();
  /** The cell planet drawn at the live radius. */
  readonly world = computed(() => cellPlanetFor(this.radiusM()));
  readonly bake = bakeInWorker;

  readonly pose = signal<PlanetPoseId>(DEFAULT_PLANET_SCENE_SETTINGS.pose);
  readonly terrainOn = signal(DEFAULT_PLANET_SCENE_SETTINGS.terrain);
  readonly atmosphereOn = signal(DEFAULT_PLANET_SCENE_SETTINGS.atmosphere);
  readonly morph = signal(DEFAULT_PLANET_SCENE_SETTINGS.morph);
  /** `<planetClouds [enabled]>` (suite v5). On by default, as before v5. */
  readonly cloudsOn = signal(true);
  /** The water body beside the planet (suite v5). Off by default. */
  readonly waterOn = signal(false);
  /** The water spike's rig, made the first time the water goes on and kept until the page is destroyed. */
  readonly waterRig = signal<IWaterLodSpikeSphereSceneHandle | undefined>(undefined);
  /** The water's mesh: the spike sphere page's ultra tier. */
  protected readonly waterTier = waterLodSpikeSphereQuality('ultra');
  /** Test-only (visual v4): `<planetAtmosphere [sky]>`, the backdrop. Not in the panel. */
  readonly skyOn = signal(true);
  /** Test-only (visual v4): `<planetAtmosphere [haze]>`, the surface haze. Not in the panel. */
  readonly hazeOn = signal(true);
  /** Test-only (visual v4): `<planetAtmosphere [shellFade]>`; the stills turn it off. Not in the panel. */
  readonly shellFadeOn = signal(true);
  /** Test-only (suite v4): draw the terrain with {@link plainNode} instead of the planet material. Not in the panel. */
  readonly plainMaterial = signal(false);
  /** Test-only: the ground `<planetTerrain [cull]>` (the selector's own culling). On by default; the cull A/B turns it off. */
  readonly terrainCull = signal(true);
  /** An unlit basic material: no cell lookup, no lighting. The terrain sets its `positionNode`. */
  readonly plainNode = new MeshBasicNodeMaterial({ color: 0x8a8f6a });
  /**
   * The camera is carried through the morph like the ground under it (visual v5), so a pose keeps its view of the ground at
   * every morph. On in the panel; a test case turns it on with `followBend: true` and every older case has it off.
   */
  readonly followBend = signal(true);
  /** The three reference cubes ({@link REFERENCE_CUBES}, visual v5). On in the panel; off unless a case asks for them. */
  readonly references = signal(true);
  /** The page's own scripted move (the "play" buttons), or undefined. */
  readonly playing = signal<DemoMotion | undefined>(undefined);
  /** Mouse orbit: the canvas drags, looks and zooms the camera (see {@link setFreeOrbit}). Off by default. */
  readonly freeOn = signal(false);

  private readonly planet = viewChild(PlanetComponent);
  private readonly terrainLayer = viewChild<PlanetTerrainComponent>('terrainBody');
  private readonly waterLayer = viewChild<PlanetTerrainComponent>('waterBody');
  private readonly atmosphereLayer = viewChild(PlanetAtmosphereComponent);

  /** The terrain's material when it is a surface the atmosphere can light and haze (a `TerrainPlanetMaterial` is). */
  private readonly terrainSurface = computed<IAtmosphereSurface | undefined>(() => {
    const material = this.terrainLayer()?.surface();
    return material instanceof TerrainPlanetMaterial ? material : undefined;
  });
  /** The terrain's material as a planet surface, for `<planetSurfaceDetail>`; undefined while the terrain is off. */
  readonly detailSurface = computed<PlanetSurfaceMaterial | undefined>(() => {
    const material = this.terrainLayer()?.surface();
    return material instanceof PlanetSurfaceMaterial ? material : undefined;
  });
  /** Demo detail only: a faint grid over the ground, added to the terrain's material by `<planetSurfaceDetail>`. */
  readonly detailLayers: readonly PlanetSurfaceDetailLayer[] = [
    { id: 'demoGrid', layer: checkerDebugLayer({ space: 'latLon', lines: true, strength: 0.25, lineColor: '#ffd23f', lineWidthPx: 1 }).layer },
  ];
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
  private demo: { readonly motion: DemoMotion; readonly began: number } | undefined;
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
  /** The morph map of the planet's uniforms, resolved each tick (no allocation while the morph holds still). */
  private readonly morphResolver = new MorphMapResolver();
  /** The reference cubes' meshes, in {@link REFERENCE_CUBES} order. */
  private readonly cubeMeshes = REFERENCE_CUBES.map((cube) => {
    const mesh = new Mesh(
      new BoxGeometry(cube.sizeM, cube.sizeM, cube.sizeM),
      new MeshStandardNodeMaterial({ color: cube.color, emissive: cube.color, emissiveIntensity: 0.35, roughness: 0.6 }),
    );
    mesh.name = `reference cube ${cube.sizeM} m`;
    mesh.frustumCulled = false;
    return mesh;
  });
  /** Each cube's unbent centre on the globe, scene metres; remade when the baked heights change. */
  private cubeCentres: readonly Vec3[] = [];
  private cubeHeightsFor: unknown;
  /** The radius {@link cubeCentres} were made for. */
  private cubeRadiusFor = PLANET_RADIUS_M;
  /** The view mouse orbit edits while it is on; undefined otherwise. */
  private freeView: PlanetView | undefined;
  /** The canvas the mouse orbit listeners are attached to, or undefined while they are not. */
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
    this.freeView = gesture.look
      ? freeLook(this.freeView, dx, dy, height, FOV_DEG)
      : freeDrag(this.freeView, dx, dy, height, FOV_DEG, this.radiusM());
  };

  private readonly onFreePointerUp = (event: PointerEvent): void => {
    if (this.freeGesture?.pointerId === event.pointerId) this.freeGesture = undefined;
  };

  private readonly onFreeWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.freeView) this.freeView = freeZoom(this.freeView, event.deltaY, this.radiusM());
  };

  private readonly onFreeContextMenu = (event: Event): void => event.preventDefault();

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
    setMotionProgress: (t) => this.setTestProgress(t),
    isSampling: () => this.engine.fpsController.frameSampler.isActive,
    startSampling: () => this.engine.fpsController.frameSampler.start(),
    gpuSamplesSoFar: () => this.engine.fpsController.frameSampler.gpuSamples,
    stopSampling: () => this.engine.fpsController.frameSampler.stop(),
    environment: () => this.environment(),
    thumbnail: () => this.screenshot.capture({
      engine: this.engine, format: 'image/webp', quality: 0.6,
      compress: { maxWidthOrHeight: THUMBNAIL_WIDTH, fileType: 'image/webp', quality: 0.6 },
    }),
    recording: (shot) => createWaterLodSpikeRecording(this.engine.canvas, { shot, label: () => `morph ${this.morph().toFixed(2)}` }),
  };
  readonly testAdapter: TestRunAdapter<PlanetSceneTestSettings, PlanetSceneTestSettings> = createPlanetSceneTestAdapter(this.testHost);

  constructor() {
    const errors = this.engine.error$.subscribe((event) => {
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
    for (const mesh of this.cubeMeshes) {
      mesh.visible = false;
      this.engine.scene.add(mesh);
    }

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
      this.detachFreeListeners();
      errors.unsubscribe();
      tick.unsubscribe();
      rendered.unsubscribe();
      if (this.sunLight && this.ambientLight) this.engine.scene.remove(this.sunLight, this.sunLight.target, this.ambientLight);
      this.sunLight = this.ambientLight = undefined;
      for (const mesh of this.cubeMeshes) {
        this.engine.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.waterRig()?.dispose();
    });
  }

  setPose(id: PlanetPoseId): void {
    this.setFreeOrbit(false);
    this.demo = undefined;
    this.playing.set(undefined);
    this.pose.set(id);
  }

  play(motion: DemoMotion): void {
    if (this.runnerBusy()) return;
    this.setFreeOrbit(false);
    this.demo = { motion, began: performance.now() };
    this.playing.set(motion);
  }

  /**
   * Turns the mouse orbit mode on or off. On, the camera keeps the view it has now and the canvas drags (left button: spin
   * the planet; shift or right button: look), and the wheel zooms. Off, the camera goes back to the selected pose.
   */
  setFreeOrbit(on: boolean): void {
    if (on) {
      this.freeView = this.currentView();
      this.demo = undefined;
      this.playing.set(undefined);
      this.freeOn.set(true);
      this.attachFreeListeners();
    } else {
      this.freeView = undefined;
      this.freeOn.set(false);
      this.detachFreeListeners();
    }
  }

  /** Attaches the mouse orbit listeners to the canvas, once it exists (a later tick retries). */
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

  setTerrain(on: boolean): void { this.terrainOn.set(on); }
  setAtmosphere(on: boolean): void { this.atmosphereOn.set(on); }
  setClouds(on: boolean): void { this.cloudsOn.set(on); }
  setWater(on: boolean): void {
    if (on) this.ensureWaterRig();
    this.waterOn.set(on);
  }
  setMorph(value: number): void { this.morph.set(Math.min(1, Math.max(0, value))); }

  onTestProgress(progress: TestProgress | null): void {
    this.runnerBusy.set(progress !== null);
    if (progress !== null) {
      this.setFreeOrbit(false);
      this.demo = undefined;
      this.playing.set(undefined);
    }
  }

  /**
   * Makes the water spike's rig once. The rig adds its own sun and ambient light to the scene, which would double the planet's
   * lighting, so what it added is taken out again (the page's own two lights stay). Its shore, foam and depth colour read the spike's
   * own islands, not this planet's land, so they are off. Its tick and anchor steps stay subscribed until the page is destroyed.
   */
  private ensureWaterRig(): void {
    if (this.waterRig() || this.pageDestroyed) return;
    const before = new Set(this.engine.scene.children);
    const rig = createWaterLodSpikeSphereScene(this.engine, this.sun, () => undefined);
    for (const child of [...this.engine.scene.children]) {
      if (!before.has(child)) this.engine.scene.remove(child);
    }
    rig.setQuality('ultra');
    rig.setShore(false);
    rig.setFoam(false);
    rig.setDepthColour(false);
    this.waterRig.set(rig);
  }

  private readSettings(): PlanetSceneTestSettings {
    return {
      pose: this.pose(), terrain: this.terrainOn(), atmosphere: this.atmosphereOn(), morph: this.morph(),
      ...(this.plainMaterial() ? { plainMaterial: true } : {}),
      ...(this.cloudsOn() ? {} : { clouds: false }),
      ...(this.waterOn() ? { water: true } : {}),
      ...(this.skyOn() ? {} : { sky: false }),
      ...(this.hazeOn() ? {} : { haze: false }),
      ...(this.shellFadeOn() ? {} : { shellFade: false }),
      ...(this.followBend() ? { followBend: true } : {}),
      ...(this.references() ? { references: true } : {}),
      ...(this.terrainCull() ? {} : { terrainCull: false }),
      ...(this.radiusM() !== PLANET_RADIUS_M ? { radiusM: this.radiusM() } : {}),
      ...(this.testProgress !== undefined && this.testMotion ? { motion: this.testMotion } : {}),
    };
  }

  private applySettings(settings: PlanetSceneTestSettings): void {
    this.setFreeOrbit(false);
    this.demo = undefined;
    this.playing.set(undefined);
    this.radiusM.set(settings.radiusM ?? PLANET_RADIUS_M);
    this.terrainCull.set(settings.terrainCull ?? true);
    this.terrainOn.set(settings.terrain);
    this.atmosphereOn.set(settings.atmosphere);
    this.morph.set(settings.morph);
    this.plainMaterial.set(settings.plainMaterial ?? false);
    this.cloudsOn.set(settings.clouds ?? true);
    this.setWater(settings.water ?? false);
    this.skyOn.set(settings.sky ?? true);
    this.hazeOn.set(settings.haze ?? true);
    this.shellFadeOn.set(settings.shellFade ?? true);
    this.followBend.set(settings.followBend ?? false);
    this.references.set(settings.references ?? false);
    this.pose.set(settings.pose);
    this.testMotion = settings.motion;
    this.setTestProgress(settings.motion ? 0 : undefined);
  }

  /**
   * The scripted move a test runs, `t` (0..1) into it, or undefined to end it. A move that drives the morph (`morphSweep`) sets
   * `<planet [morph]>` here, in step with the progress, so the page's morph is the sweep's value when a sample is taken.
   */
  private setTestProgress(t: number | undefined): void {
    this.testProgress = t;
    if (t === undefined || !this.testMotion) return;
    const morph = motionMorph(this.testMotion, t);
    if (morph !== undefined) this.morph.set(morph);
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
    if (this.waterOn()) {
      const water = this.waterLayer()?.terrain();
      if (!water) return 'the water body';
      if (!water.object.visible) return "the water body's pipeline";
    }
    // A radius change reaches `<planet>` at the next change detection, and its bake restarts after that; `heights()` is
    // undefined for the old radius from then on, so the checks below wait for the bake of the new radius.
    if (this.planet()?.radius() !== this.radiusM()) return 'the planet to take the new radius';
    if (!this.terrainOn()) return '';
    const layer = this.terrainLayer();
    const body = layer?.terrain();
    if (!layer || !body) return 'the terrain';
    const heights = this.planet()?.heights();
    if (!heights) return 'the height bake';
    if (body.settings.heights !== heights) return 'the terrain to take the baked heights';
    if (this.plainMaterial() && body.settings.material !== this.plainNode) return 'the terrain to take the plain material';
    if (!this.plainMaterial() && body.settings.material === this.plainNode) return 'the terrain to leave the plain material';
    const surface = layer.surface();
    if (surface && body.settings.material !== surface) return "the terrain to take the planet's material";
    if (!body.object.visible) return "the terrain's pipeline";
    const attachable = this.terrainSurface();
    if (attachable && !atmosphere.hasSurface(attachable)) return 'the atmosphere to reach the terrain';
    return '';
  }

  private currentView(): PlanetView {
    if (this.testProgress !== undefined && this.testMotion) return motionView(this.testMotion, this.testProgress, this.pose(), this.radiusM());
    if (this.freeOn() && this.freeView) return this.freeView;
    const demo = this.demo;
    if (demo) {
      const t = (performance.now() - demo.began) / (PLAY_SECONDS[demo.motion] * 1000);
      if (t < 1) return motionView(demo.motion, t, 'orbit', this.radiusM());
      // The move ends where it ends: the eye pose it finishes on, then the buttons are free again.
      this.demo = undefined;
      this.playing.set(undefined);
      this.pose.set(demo.motion === 'descent' ? 'ground' : 'ground');
    }
    return planetPoseView(this.pose(), this.radiusM());
  }

  /** Every tick: place the camera on the view, with the eye kept above the drawn ground. The terrain selects in `beforeRender$`. */
  private update(): void {
    if (this.freeOn()) this.attachFreeListeners();
    const view = this.currentView();
    const R = this.radiusM();
    const up = groundUp(view);
    const layer = this.terrainLayer();
    let groundHeight = 0;
    if (layer && this.terrainOn()) {
      const sample = layer.groundAt([up[0] * R, up[1] * R, up[2] * R] as Vec3, this.groundSample);
      if (sample) groundHeight = sample.heightM;
    }
    // The morph the terrain draws with this frame: the planet's uniforms (set from `[morph]`), not the signal.
    const uniforms = this.planet()?.morphUniforms;
    const map = uniforms ? this.morphResolver.resolve(uniforms, R) : undefined;
    const globeCamera = resolvePlanetCamera(view, R, groundHeight);
    const camera = map && this.followBend() ? bendPlanetCamera(globeCamera, map) : globeCamera;
    this.placeCubes(map);
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

  /**
   * Places the reference cubes for this frame: each centre on the drawn ground (the terrain's height under it, sampled once
   * the heights are baked, plus {@link referenceCubeLift}), bent by the morph, and turned with the bent east and up there, so
   * a cube sits on the bent ground the way it sits on the globe.
   */
  private placeCubes(map: MorphMap | undefined): void {
    const show = this.references();
    const R = this.radiusM();
    // Only the cubes that fit the world are shown (see referenceCubesFor).
    const fitting = referenceCubesFor(R);
    this.cubeMeshes.forEach((mesh, i) => { mesh.visible = show && fitting.includes(REFERENCE_CUBES[i]); });
    if (!show) return;
    const heights = this.planet()?.heights();
    if (this.cubeRadiusFor !== R) {
      // A new radius: the old centres and the sampling of the old bake no longer apply.
      this.cubeCentres = [];
      this.cubeHeightsFor = undefined;
      this.cubeRadiusFor = R;
    }
    if (this.cubeCentres.length === 0 || (heights && heights !== this.cubeHeightsFor)) {
      const layer = this.terrainLayer();
      const ready = !!heights && !!layer && this.terrainOn();
      this.cubeCentres = REFERENCE_CUBES.map((cube) => {
        const up = referenceCubeGround(cube, R);
        const sample = ready ? layer!.groundAt([up[0] * R, up[1] * R, up[2] * R] as Vec3, this.groundSample) : undefined;
        const r = R + (sample?.heightM ?? 0) + referenceCubeLift(cube, R);
        return [up[0] * r, up[1] * r, up[2] * r] as Vec3;
      });
      // Sampled from the baked heights: keep it. Before the bake lands, sample again next tick.
      this.cubeHeightsFor = ready ? heights : undefined;
    }
    const [x, y, z] = this.axes;
    for (let i = 0; i < this.cubeMeshes.length; i++) {
      const mesh = this.cubeMeshes[i];
      if (!mesh.visible) continue;
      const centre = this.cubeCentres[i];
      const frame = groundFrame('sphere', centre);
      let east: Vec3 = frame.east;
      let up: Vec3 = frame.up;
      let position: Vec3 = centre;
      if (map && map.morph !== 0) {
        position = bendGlobePoint(map, centre);
        east = bentDirection(map, centre, frame.east);
        const bentUp = bentDirection(map, centre, frame.up);
        const along = bentUp[0] * east[0] + bentUp[1] * east[1] + bentUp[2] * east[2];
        const square = [bentUp[0] - along * east[0], bentUp[1] - along * east[1], bentUp[2] - along * east[2]];
        const length = Math.hypot(square[0], square[1], square[2]);
        up = [square[0] / length, square[1] / length, square[2] / length];
      }
      x.set(east[0], east[1], east[2]);
      y.set(up[0], up[1], up[2]);
      z.crossVectors(x, y);
      mesh.position.set(position[0], position[1], position[2]);
      mesh.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
      mesh.updateMatrixWorld();
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
      'planet.radiusM': this.radiusM(),
      'planet.world': `cell planet seed ${this.world().seed}, ${this.world().cellCount} cells, ${this.world().heightScaleM} m per unit`,
      'surface.material': 'terrain-planet',
      clouds: 'shell',
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
