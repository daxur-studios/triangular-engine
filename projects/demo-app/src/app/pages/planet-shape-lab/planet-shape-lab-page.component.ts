import { Component, DestroyRef, computed, inject, isDevMode, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AmbientLight, Color, DirectionalLight, FloatType, Matrix4, Mesh, OrthographicCamera, PerspectiveCamera, Quaternion, RenderTarget, Scene, Vector3,
} from 'three';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { TestRunnerComponent, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import { adapterLabel, describeGpuAdapter, type GpuAdapterRendererLike } from './gpu-adapter-info';
import {
  CAMERA_POSES, cameraViewFromPose, lookCameraView, panCameraView, resolveCameraPose, resolveCameraView, zoomCameraView,
  type CameraPoseId, type CameraView, type ResolvedCameraPose,
} from './planet-shape-camera';
import {
  BODIES, FIXED_SEED, MAX_SPIN_WARP, MIN_SPIN_WARP, REFERENCE_DRAWING_BUFFER, SPHERE_SEGMENTS, bodyById, spinAngleAfter,
  sunDirectionBody, type BodyId,
} from './planet-shape-config';
import { FEATURES, defaultFeatureState, shadowsActive, withFeature, type FeatureId, type FeatureState } from './planet-shape-features';
import { createCameraRelativeSphereGeometry, createPlainSphereMaterial } from './planet-shape-sphere';
import { TERRAIN_EDIT_PRESETS, shapeOpPreset, type TerrainEditPresetId } from './planet-shape-edits';
import { DEFAULT_RAY_STEPS, createRaymarchTerrain, type RaymarchTerrain } from './planet-shape-raymarch';
import { createLitRaymarchTerrain } from './planet-shape-raymarch-lit';
import { createMeshTerrain } from './contender-b/mesh-terrain';
import { RAY_BIOMES, RAY_ROCKS, type RayBiome, type RayRock } from './planet-shape-tests';
import { QUALITY_PROBE_SIZE, frameFromProbeRgba, type QualityFrame } from './planet-shape-quality';
import { TERRAIN_PROBE_SIZE, terrainFrameFromRgba, type TerrainDepthFrame } from './planet-shape-terrain-quality';
import {
  createPlanetShapeTestAdapter, type PlanetShapeQualityProbe, type PlanetShapeTerrainProbe, type PlanetShapeTestHost,
} from './planet-shape-test-adapter';
import { PLANET_SHAPE_TEST_HISTORY, type PlanetShapeTestSettings } from './planet-shape-tests';

/**
 * Plan 055 Phase 0: the test track every planet-shape contender is measured on. No terrain yet: a plain sphere in a
 * body-fixed frame at three sizes, one shared camera rig of named poses, a spinning planet with a time warp, and a
 * feature registry for ablation. WebGPU only (Plan 055 D4): without it the page says so and draws nothing.
 *
 * Frames: the body-fixed frame is the render frame. The mesh never moves; the camera sits at the origin and rides with the
 * surface; the sun turns around the planet at the spin rate. Vertices are drawn camera-relative (see
 * `planet-shape-sphere.ts`), so 6,371 km does not jitter. GPU time is split per render pass (scene, shadow, output; see
 * the adapter) by the engine's `gpuTiming`.
 */
function formatAltitude(metres: number): string {
  return metres >= 10_000 ? `${Math.round(metres / 1000).toLocaleString('en-US')} km` : `${Math.round(metres)} m`;
}

/**
 * The engine's default request (without it Chrome on a hybrid laptop handed WebGPU the integrated GPU, amd / gcn-5).
 * The browser may still ignore it; `gpu.vendor` records what it chose.
 */
const POWER_PREFERENCE = 'high-performance (engine default)';

/** How long the terrain probe waits for its pipelines to compile before it gives up. */
const TERRAIN_PROBE_COMPILE_MS = 60_000;

/** Longest side of a case thumbnail, in pixels. */
const THUMBNAIL_WIDTH = 240;

/** Tessellation of the raymarch shell: coarse, since it only has to cover the pixels the march may hit. */
const SHELL_SEGMENTS = { width: 128, height: 64 } as const;
const RAY_STEP_PRESETS = [32, 64, 128, 256] as const;
type RaymarchSurface = 'raymarch' | 'raymarch-lit';
type Surface = 'sphere' | RaymarchSurface | 'mesh-b';

type MeshTerrainUpdate = ReturnType<typeof createMeshTerrain>['update'];

const BODY_FRAME_NOTE ='Body-fixed frame: the camera rides with the surface, so spin shows as a travelling sun.';

@Component({
  standalone: true,
  selector: 'app-planet-shape-lab-page',
  imports: [EngineModule, RouterLink, TestRunnerComponent],
  providers: [
    EngineService.provide({
      showFPS: true,
      gpuTiming: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, trackTimestamp: true },
    }),
    // Case thumbnails for the results page: ScreenshotService compresses through this adapter.
    provideBrowserImageCompression(),
  ],
  host: {
    class: 'flex-page',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
    '(wheel)': 'onWheel($event)',
    '(contextmenu)': 'onContextMenu($event)',
  },
  template: `
    <scene />

    @if (!webGpuOk()) {
      <div class="blocker" role="alert">
        <h2>WebGPU required</h2>
        <p>
          The planet shape lab measures the WebGPU renderer only and has no WebGL fallback (Plan 055 D4).
          {{ webGpuReason() }}
        </p>
        <a routerLink="/">← Examples</a>
      </div>
    }

    <aside class="panel" (pointermove)="$event.stopPropagation()" (wheel)="$event.stopPropagation()">
      <a routerLink="/">← Examples</a>
      <h2>Planet shape lab · Plan 055</h2>
      <p class="hud" data-testid="hud">
        {{ hud().backend }} · drawing buffer {{ hud().width }}×{{ hud().height }}
        @if (!hud().matchesReference) { (reference {{ reference.width }}×{{ reference.height }}) }
        · DPR {{ hud().dpr }}<br />
        {{ hud().adapter }}@if (hud().software) { <b> · SOFTWARE RENDERER, not hardware timing</b> }<br />
        seed {{ seed }} · {{ bodyRadiusLabel() }} · pose {{ poseId() }} · {{ drawnTriangles() }} triangles
      </p>

      <tri-test-runner
        [suites]="testHistory" [adapter]="testAdapter" [available]="runnerReady()"
        [allowAutoStart]="allowTestAutoStart" [resultSink]="true" (progressChange)="onTestProgress($event)" />
      <p class="note">Keep the tab visible and focused for timing. Headless or software runs are functional evidence only.</p>

      <fieldset class="controls" [disabled]="runnerBusy()">
        <p class="label">Body radius</p>
        <p class="row">
          @for (body of bodies; track body.id) {
            <button (click)="setBody(body.id)" [class.active]="bodyId() === body.id">{{ body.label }}</button>
          }
        </p>

        <p class="label">Camera pose</p>
        <p class="row">
          @for (pose of poses; track pose.id) {
            <button (click)="setPose(pose.id)" [class.active]="!freeCamera() && poseId() === pose.id">{{ pose.label }}</button>
          }
        </p>
        <label class="feature">
          <input type="checkbox" [checked]="freeCamera()" (change)="setFreeCamera($any($event.target).checked)" />
          Free camera (starts from the current pose)
        </label>
        @if (freeCamera()) {
          <p class="note">Left drag: move over the planet · right drag: turn and tilt · wheel: altitude ({{ freeAltitudeLabel() }}).
            A test run or a pose button returns to the named poses.</p>
        }

        <p class="label">Body spin · time warp {{ spinWarp() === 0 ? 'paused' : formatWarp(spinWarp()) + 'x' }}</p>
        <input
          type="range" min="0" max="6" step="0.01" aria-label="Time warp, logarithmic"
          [disabled]="spinWarp() === 0" [value]="warpExponent()" (input)="setSpinWarp(logWarp($event))" />
        <p class="row">
          <button (click)="setSpinWarp(spinWarp() === 0 ? 1000 : 0)" [class.active]="spinWarp() === 0">pause</button>
          @for (warp of warpPresets; track warp) {
            <button (click)="setSpinWarp(warp)" [class.active]="spinWarp() === warp">{{ formatWarp(warp) }}x</button>
          }
        </p>

        <p class="label">Surface</p>
        <p class="row">
          <button (click)="setSurface('sphere')" [class.active]="surface() === 'sphere'">plain sphere</button>
          <button (click)="setSurface('raymarch')" [class.active]="surface() === 'raymarch'" data-testid="surface-raymarch">raymarched terrain</button>
          <button (click)="setSurface('raymarch-lit')" [class.active]="surface() === 'raymarch-lit'" data-testid="surface-raymarch-lit">terrain v2 (canyons, shadertoy-style)</button>
          <button (click)="setSurface('mesh-b')" [class.active]="surface() === 'mesh-b'" data-testid="surface-mesh-b">contender B (mesh, stage 1: shell)</button>
        </p>
        @if (surface() !== 'sphere') {
          @if (surface() !== 'mesh-b') {
            <p class="row">
              steps:
              @for (steps of rayStepPresets; track steps) {
                <button (click)="setRaySteps(steps)" [class.active]="raySteps() === steps">{{ steps }}</button>
              }
            </p>
          }
          @if (surface() === 'raymarch-lit') {
            <p class="row">
              pre-pass:
              @for (scale of rayPrepassPresets; track scale) {
                <button (click)="setRayPrepass(scale)" [class.active]="rayPrepass() === scale" [attr.data-testid]="'prepass-' + scale">
                  {{ scale === 0 ? 'off' : '1/' + scale }}</button>
              }
            </p>
          }
          @if (surface() === 'raymarch-lit' || surface() === 'mesh-b') {
            <p class="row">
              biome:
              @for (biome of rayBiomes; track biome) {
                <button (click)="setRayBiome(biome)" [class.active]="rayBiome() === biome" [attr.data-testid]="'biome-' + biome">{{ biome }}</button>
              }
            </p>
            <p class="row">
              rock:
              @for (rock of rayRocks; track rock) {
                <button (click)="setRayRock(rock)" [class.active]="rayRock() === rock && rayRockMix() === undefined" [attr.data-testid]="'rock-' + rock">{{ rock }}</button>
              }
            </p>
            <p class="row">
              wild → grounded · {{ rayRockMix() === undefined ? '-' : rayRockMix()!.toFixed(2) }}
              <input
                type="range" min="0" max="1" step="0.05" aria-label="Rock mix, wild to grounded" data-testid="rock-mix"
                [value]="rayRockMix() ?? 0.5" (input)="setRayRockMix(+$any($event.target).value)" />
            </p>
            <p class="row">
              edits:
              @for (preset of rayEditPresets; track preset.id) {
                <button (click)="setRayEdits(preset.id)" [class.active]="rayEdits() === preset.id" [attr.data-testid]="'edits-' + preset.id">
                  {{ preset.label }}</button>
              }
            </p>
          }
          @if (surface() === 'mesh-b') {
            <label class="feature">
              <input type="checkbox" [checked]="meshBlocks()" (change)="setMeshBlocks($any($event.target).checked)" data-testid="mesh-blocks" />
              Near volume zone (off: the shell alone, contender A)
            </label>
            <p class="note">Contender B (Plan 055 D15), seam spike stage 2: the height shell, the same field as terrain v2,
              and around the ground under the camera a zone of one level meshed in 3D (surface nets on the scanned columns),
              so overhangs near the camera are drawn. Rebuilt when the camera moves (columns scanned on the GPU, the mesh
              assembled on the CPU), so moving shows a pause. {{ meshBLabel() }}</p>
          } @else if (surface() === 'raymarch') {
            <p class="note">Contender C, minimal (Plan 055 Phase 1): a shell at R + H whose pixels sphere-trace one fixed
              height field. No morph and no shadows yet; a flat pad under the poses keeps the camera out of the hills.</p>
          } @else {
            <p class="note">Contender C, second try: a 3D density field (canyons plus vertically stretched rock noise, so
              ledges and overhangs), camera-relative detail noise for close range, a sky (no fog). The Shadows feature turns
              on a soft shadow march. Marches twice the chosen steps. No morph. The pre-pass marches at a fraction of the
              resolution first, so the full march starts next to the ground.</p>
          }
        }

        <p class="label">Morph (sphere to flat map) · {{ morph().toFixed(2) }}</p>
        <input
          type="range" min="0" max="1" step="0.01" aria-label="Morph, sphere to flat map" data-testid="morph-slider"
          [value]="morph()" (input)="setMorph(+$any($event.target).value)" />
        <p class="note">Visual only (the engine's bend morph in the vertex stage). The sphere casts and receives no shadow
          while morph &gt; 0. The flat map faces the poses (centred on longitude 0) and passes through the planet
          centre; the camera rides along over the same ground.</p>

        <p class="label">Features</p>
        @for (feature of features; track feature.id) {
          <label class="feature" [title]="feature.description">
            <input type="checkbox" [checked]="featureState()[feature.id]" (change)="setFeature(feature.id, $any($event.target).checked)" />
            {{ feature.label }}
          </label>
        }
        <p class="row">
          <button (click)="setBodyDrawn(!bodyDrawn())" [class.active]="!bodyDrawn()">
            empty frame (draw nothing): {{ bodyDrawn() ? 'off' : 'on' }}
          </button>
        </p>
      </fieldset>
      <p class="note">{{ frameNote }}</p>
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
    .row { display: flex; gap: 4px; flex-wrap: wrap; margin: 0.3rem 0; }
    .label { margin: 0.6rem 0 0; opacity: 0.7; }
    .note { opacity: 0.6; margin: 0.5rem 0 0; }
    .feature { display: block; margin: 0.2rem 0; }
    button.active { outline: 2px solid #6cf; }
    .blocker {
      position: absolute; inset: 0; z-index: 30; display: grid; place-content: center; gap: 0.5rem; padding: 2rem;
      background: rgba(5, 8, 12, 0.92); color: #eee; font: 15px/1.5 system-ui; text-align: center;
    }
  `,
})
export class PlanetShapeLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly screenshot = inject(ScreenshotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly bodies = BODIES;
  readonly poses = CAMERA_POSES;
  readonly features = FEATURES;
  readonly seed = FIXED_SEED;
  readonly reference = REFERENCE_DRAWING_BUFFER;
  readonly frameNote = BODY_FRAME_NOTE;
  readonly warpPresets = [1, 1000, 100_000, MAX_SPIN_WARP];
  readonly testHistory = PLANET_SHAPE_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();

  readonly bodyId = signal<BodyId>('600km');
  readonly poseId = signal<CameraPoseId>('orbit');
  readonly spinWarp = signal(1000);
  readonly featureState = signal<FeatureState>(defaultFeatureState());
  readonly bodyDrawn = signal(true);
  readonly surface = signal<Surface>('sphere');
  readonly raySteps = signal(DEFAULT_RAY_STEPS);
  readonly rayStepPresets = RAY_STEP_PRESETS;
  /** Pre-pass resolution divisor of terrain v2; 0 = off. */
  readonly rayPrepass = signal(0);
  readonly rayPrepassPresets = [0, 2, 4, 8] as const;
  /** Terrain v2 edit list: the pad, none, or the pad plus one edit of each kind. */
  readonly rayEdits = signal<TerrainEditPresetId>('pad');
  readonly rayEditPresets = TERRAIN_EDIT_PRESETS;
  /** Terrain v2 biomes: the blend mask, or one biome everywhere. */
  readonly rayBiome = signal<RayBiome>('blend');
  readonly rayBiomes = RAY_BIOMES;
  /** Terrain v2 rock: each biome's own, wild everywhere or grounded everywhere. */
  readonly rayRock = signal<RayRock>('biome');
  readonly rayRocks = RAY_ROCKS;
  /** Lab-only: a grounded share between 0 and 1 everywhere (both rock modes evaluated); `undefined` when a button rules. */
  readonly rayRockMix = signal<number | undefined>(undefined);
  /** Sphere (0) to flat map (1). */
  readonly morph = signal(0);
  readonly freeCamera = signal(false);
  readonly freeAltitudeLabel = signal('');
  readonly warpExponent = computed(() => Math.log10(Math.max(MIN_SPIN_WARP, this.spinWarp())));
  readonly bodyRadiusLabel = computed(() => bodyById(this.bodyId()).label + ' radius');
  readonly drawnTriangles = signal(0);
  /** Contender B's last build, for the note under the surface buttons. */
  readonly meshBLabel = signal('');
  /** Contender B's near volume zone on (B) or off (the shell alone: contender A). */
  readonly meshBlocks = signal(true);

  readonly webGpuOk = signal(typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu);
  readonly webGpuReason = signal(this.webGpuOk() ? '' : 'This browser exposes no navigator.gpu.');
  readonly runnerReady = signal(false);
  readonly runnerBusy = signal(false);
  readonly hud = signal({
    backend: 'starting', width: 0, height: 0, dpr: 1, adapter: 'adapter unknown', software: false, matchesReference: false,
  });

  private spinAngle = 0;
  private renderedFrames = 0;
  private engineError = '';
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private cameraDirty = true;
  private pose: ResolvedCameraPose = resolveCameraPose('orbit', '600km');
  private freeView: CameraView = cameraViewFromPose('orbit', '600km');
  private drag: { pointerId: number; look: boolean } | undefined;
  private readonly cameraQuaternion = new Quaternion();
  private readonly basis = new Matrix4();
  private readonly right = new Vector3();
  private readonly upVector = new Vector3();
  private readonly backward = new Vector3();
  private readonly sunDirection: [number, number, number] = [0, 0, 1];
  private builtBody: BodyId = '600km';

  private readonly sphere = createPlainSphereMaterial();
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly ambient = new AmbientLight(0x6688aa, 0.3);
  private mesh: Mesh | undefined;
  /** The raymarched surfaces, each with its own shell; at most one is visible. */
  private readonly rayTerrains: { surface: RaymarchSurface; terrain: RaymarchTerrain; shell?: Mesh }[] = [
    { surface: 'raymarch', terrain: createRaymarchTerrain() },
    { surface: 'raymarch-lit', terrain: createLitRaymarchTerrain() },
  ];
  /** Contender B (`contender-b/`); drawn when the surface is `mesh-b`. */
  private readonly meshB = createMeshTerrain();
  /** Contender B's rebuild in progress, if any. */
  private meshBUpdate: Promise<void> | undefined;
  /** Whether the raymarch pipelines are compiled: done before the runner may start, so no case pays for it. */
  private terrainCompile: 'pending' | 'running' | 'done' = 'pending';
  /** Quality probe target and camera, made on first use (`planet-shape-quality.ts`). */
  private probe: { target: RenderTarget; camera: PerspectiveCamera; scene: Scene; mesh: Mesh } | undefined;
  /** Terrain probe target, camera and shell, made on first use (`planet-shape-terrain-quality.ts`). */
  private terrainProbeParts: { target: RenderTarget; camera: PerspectiveCamera; scene: Scene; mesh: Mesh } | undefined;
  private readonly beforeRenderCallbacks = new Set<() => void>();
  /** The pre-pass draws the visible shell again, with the terrain's pre-pass material, into the terrain's target. */
  private readonly prepassMesh = Object.assign(new Mesh(), { frustumCulled: false });
  private readonly prepassScene = Object.assign(new Scene(), { name: 'Raymarch pre-pass' }).add(this.prepassMesh);
  private readonly prepassClear = new Color();
  private readonly renderCallbacks = new Set<(renderedAt: number) => void>();

  /** Everything the shared runner needs from this page; the runner never sees the scene. */
  private readonly testHost: PlanetShapeTestHost = {
    read: () => ({
      kind: this.bodyDrawn() ? this.surface() : 'empty', raySteps: this.raySteps(), rayPrepass: this.rayPrepass(), rayEdits: this.rayEdits(), rayBiome: this.rayBiome(), rayRock: this.rayRock(), seed: this.seed, bodyId: this.bodyId(), poseId: this.poseId(),
      spinWarp: this.spinWarp(), spinAngleDeg: (this.spinAngle * 180) / Math.PI, features: this.featureState(),
      morph: this.morph(), ...(this.freeCamera() ? { view: this.freeView } : {}), meshBlocks: this.meshBlocks(),
    }),
    apply: (settings) => {
      if (settings.seed !== this.seed) throw new Error(`Unknown seed ${settings.seed}; this lab is fixed to ${this.seed}`);
      this.setBody(settings.bodyId);
      this.setPose(settings.poseId);
      if (settings.view) this.setFreeView(settings.view);
      this.spinWarp.set(settings.spinWarp);
      this.spinAngle = (settings.spinAngleDeg * Math.PI) / 180;
      this.featureState.set(settings.features);
      this.setMorph(settings.morph);
      this.setRaySteps(settings.raySteps);
      this.setRayPrepass(settings.rayPrepass);
      this.setRayEdits(settings.rayEdits);
      this.setRayBiome(settings.rayBiome);
      this.setRayRock(settings.rayRock);
      this.setMeshBlocks(settings.meshBlocks ?? true);
      if (settings.kind !== 'empty') this.setSurface(settings.kind);
      this.setBodyDrawn(settings.kind !== 'empty');
    },
    renderedFrames: () => this.renderedFrames,
    errors: () => this.engineError,
    resetErrors: () => { this.engineError = ''; },
    backendIsWebGpu: () => this.webGpuOk() && this.hud().backend === 'webgpu',
    scene: () => ({
      bodyDrawn: this.bodyDrawn() && (this.mesh?.visible === true || this.meshB.mesh.visible
        || this.rayTerrains.some((entry) => entry.shell?.visible === true)),
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      drawingBuffer: [this.hud().width, this.hud().height],
    }),
    onBeforeRender: (callback) => { this.beforeRenderCallbacks.add(callback); return () => this.beforeRenderCallbacks.delete(callback); },
    onRenderComplete: (callback) => { this.renderCallbacks.add(callback); return () => this.renderCallbacks.delete(callback); },
    isSampling: () => this.engine.fpsController.frameSampler.isActive,
    startSampling: () => this.engine.fpsController.frameSampler.start(),
    gpuSamplesSoFar: () => this.engine.fpsController.frameSampler.gpuSamples,
    stopSampling: () => this.engine.fpsController.frameSampler.stop(),
    environment: () => this.environment(),
    // Fast path (no resolution, multiplier or samples): the renderer is not resized, and the session calls this only after
    // a measurement. 240 px WebP at quality 0.6 is a few KB.
    thumbnail: () => this.screenshot.capture({
      engine: this.engine, format: 'image/webp', quality: 0.6,
      compress: { maxWidthOrHeight: THUMBNAIL_WIDTH, fileType: 'image/webp', quality: 0.6 },
    }),
    qualityProbe: () => this.qualityProbe(),
    terrainProbe: () => this.terrainProbe(),
  };
  readonly testAdapter: TestRunAdapter<PlanetShapeTestSettings, PlanetShapeTestSettings> = createPlanetShapeTestAdapter(this.testHost);

  constructor() {
    const errors = this.engine.error$.subscribe((event) => { this.engineError ||= `${event.phase}: ${String(event.error)}`; });
    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) camera.fov = 60;

    if (this.webGpuOk()) {
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0005;
      this.configureShadow(bodyById(this.builtBody).radiusM);
      this.mesh = new Mesh(createCameraRelativeSphereGeometry(bodyById(this.builtBody).radiusM, SPHERE_SEGMENTS.width, SPHERE_SEGMENTS.height), this.sphere.material);
      this.mesh.frustumCulled = false;
      for (const entry of this.rayTerrains) {
        entry.shell = new Mesh(this.shellGeometry(entry.terrain, bodyById(this.builtBody).radiusM), entry.terrain.material);
        entry.shell.frustumCulled = false;
        entry.shell.visible = false;
        entry.terrain.setBody(bodyById(this.builtBody).radiusM);
        this.engine.scene.add(entry.shell);
      }
      this.meshB.mesh.visible = false;
      this.meshB.setBody(bodyById(this.builtBody).radiusM);
      this.engine.scene.add(this.mesh, this.meshB.mesh, this.sun, this.sun.target, this.ambient);
      this.setBody(this.builtBody);
      this.applyRayEdits();
      this.sphere.setBodyRadius(bodyById(this.builtBody).radiusM);
      this.applyFeatures();
    }

    const tick = this.engine.tick$.subscribe((delta) => {
      if (this.spinWarp() > 0) this.spinAngle = spinAngleAfter(this.spinAngle, delta, this.spinWarp());
      this.updateSun();
      this.updateCamera();
      this.updatePixelAngle();
      void this.updateMeshB();
    });
    const beforeRender = this.engine.beforeRender$.subscribe(() => {
      this.renderPrepass();
      for (const callback of this.beforeRenderCallbacks) callback();
    });
    const rendered = this.engine.renderComplete$.subscribe(({ renderedAt }) => {
      this.renderedFrames++;
      const renderer = this.engine.renderer as unknown as GpuAdapterRendererLike & { info?: { render: { drawCalls: number; triangles: number } } };
      this.lastDrawCalls = renderer.info?.render.drawCalls ?? 0;
      this.lastTriangles = renderer.info?.render.triangles ?? 0;
      // The adapter and buffer size change rarely; reading them allocates, so not every frame.
      if (this.renderedFrames % 30 === 1) this.refreshHud(renderer);
      for (const callback of this.renderCallbacks) callback(renderedAt);
    });
    this.destroyRef.onDestroy(() => {
      this.runnerReady.set(false);
      errors.unsubscribe();
      tick.unsubscribe();
      beforeRender.unsubscribe();
      rendered.unsubscribe();
      if (this.mesh) {
        this.engine.scene.remove(this.mesh, this.sun, this.sun.target, this.ambient);
        this.mesh.geometry.dispose();
      }
      for (const entry of this.rayTerrains) {
        if (entry.shell) {
          this.engine.scene.remove(entry.shell);
          entry.shell.geometry.dispose();
        }
        entry.terrain.material.dispose();
      }
      this.engine.scene.remove(this.meshB.mesh);
      this.meshB.dispose();
      this.probe?.target.dispose();
      this.terrainProbeParts?.target.dispose();
      this.sphere.material.dispose();
      this.sphere.probeMaterial.dispose();
    });
  }

  setBody(id: BodyId): void {
    if (!this.mesh) return;
    if (id !== this.builtBody) {
      const radius = bodyById(id).radiusM;
      this.mesh.geometry.dispose();
      this.mesh.geometry = createCameraRelativeSphereGeometry(radius, SPHERE_SEGMENTS.width, SPHERE_SEGMENTS.height);
      this.configureShadow(radius);
      this.sphere.setBodyRadius(radius);
      for (const entry of this.rayTerrains) {
        if (entry.shell) {
          entry.shell.geometry.dispose();
          entry.shell.geometry = this.shellGeometry(entry.terrain, radius);
        }
        entry.terrain.setBody(radius);
      }
      this.meshB.setBody(radius);
      this.builtBody = id;
      this.applyRayEdits();
    }
    this.bodyId.set(id);
    this.drawnTriangles.set(Math.round((this.mesh.geometry.index?.count ?? 0) / 3));
    this.resolvePose();
  }

  setPose(id: CameraPoseId): void {
    this.freeCamera.set(false);
    this.drag = undefined;
    this.poseId.set(id);
    this.resolvePose();
  }

  /** Hand-driven camera for looking around. Off for every test: the runner applies named poses through `setPose`. */
  setFreeCamera(on: boolean): void {
    if (on) this.freeView = cameraViewFromPose(this.poseId(), this.bodyId());
    this.freeCamera.set(on);
    this.drag = undefined;
    this.resolvePose();
  }

  /** The free camera at a given view (a test's close-up). */
  setFreeView(view: CameraView): void {
    this.freeView = view;
    this.freeCamera.set(true);
    this.drag = undefined;
    this.resolvePose();
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.freeCamera() || this.runnerBusy() || this.fromPanel(event)) return;
    this.drag = { pointerId: event.pointerId, look: event.button === 2 || event.shiftKey };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const height = Math.max(1, (event.currentTarget as HTMLElement).clientHeight);
    const dx = event.movementX / height;
    const dy = event.movementY / height;
    this.freeView = this.drag.look ? lookCameraView(this.freeView, dx, dy) : panCameraView(this.freeView, dx, dy, this.bodyId());
    this.resolvePose();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.drag = undefined;
  }

  onWheel(event: WheelEvent): void {
    if (!this.freeCamera() || this.runnerBusy() || this.fromPanel(event)) return;
    event.preventDefault();
    this.freeView = zoomCameraView(this.freeView, Math.sign(event.deltaY), this.bodyId());
    this.resolvePose();
  }

  onContextMenu(event: MouseEvent): void {
    if (this.freeCamera() && !this.fromPanel(event)) event.preventDefault();
  }

  private fromPanel(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.panel, .blocker') !== null;
  }

  setSpinWarp(warp: number): void {
    this.spinWarp.set(warp === 0 ? 0 : Math.min(MAX_SPIN_WARP, Math.max(MIN_SPIN_WARP, warp)));
  }

  logWarp(event: Event): number {
    return Math.round(10 ** Number((event.target as HTMLInputElement).value));
  }

  formatWarp(warp: number): string {
    return warp.toLocaleString('en-US');
  }

  setFeature(id: FeatureId, on: boolean): void {
    this.featureState.update((state) => withFeature(state, id, on));
    this.applyFeatures();
  }

  /** Morph 0..1, applied by the engine's `planetMorphGraph` in the vertex stage; body-fixed data is untouched. */
  setMorph(value: number): void {
    const morph = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    this.morph.set(morph);
    this.sphere.setMorph(morph);
    this.applyFeatures();
    // The camera rides the morph over the same ground (see `resolveCameraView`).
    this.resolvePose();
  }

  setBodyDrawn(drawn: boolean): void {
    this.bodyDrawn.set(drawn);
    this.applySurface();
    this.sun.visible = drawn;
  }

  /** Which surface draws: the plain sphere or the raymarched terrain (never both, so the scene pass is one of them). */
  setSurface(surface: Surface): void {
    this.surface.set(surface);
    this.applySurface();
    this.applyFeatures();
  }

  setRaySteps(steps: number): void {
    this.raySteps.set(steps);
    for (const entry of this.rayTerrains) entry.terrain.setSteps(steps);
  }

  setRayPrepass(scale: number): void {
    this.rayPrepass.set(scale);
  }

  setRayBiome(biome: RayBiome): void {
    this.rayBiome.set(biome);
    const value = biome === 'canyons' ? 0 : biome === 'hills' ? 1 : undefined;
    for (const entry of this.rayTerrains) entry.terrain.setBiome?.(value);
    this.meshB.setBiome(value);
  }

  setRayRockMix(share: number): void {
    this.rayRockMix.set(share);
    for (const entry of this.rayTerrains) entry.terrain.setRock?.(share);
    this.meshB.setRock(share);
  }

  setRayRock(rock: RayRock): void {
    this.rayRock.set(rock);
    this.rayRockMix.set(undefined);
    const value = rock === 'wild' ? 0 : rock === 'grounded' ? 1 : undefined;
    for (const entry of this.rayTerrains) entry.terrain.setRock?.(value);
    this.meshB.setRock(value);
  }

  setMeshBlocks(on: boolean): void {
    this.meshBlocks.set(on);
    this.meshB.setBlocks(on);
  }

  setRayEdits(id: TerrainEditPresetId): void {
    this.rayEdits.set(id);
    this.applyRayEdits();
  }

  private applyRayEdits(): void {
    const ops = shapeOpPreset(this.rayEdits(), bodyById(this.builtBody).radiusM);
    for (const entry of this.rayTerrains) entry.terrain.setShapeOps?.(ops);
    this.meshB.setShapeOps(ops);
  }

  /**
   * The visible terrain's low-resolution pre-pass, drawn into its own target just before the frame. It is a scene pass
   * of its own (label `Raymarch pre-pass`), so the scene-pass metric includes it.
   */
  private renderPrepass(): void {
    const entry = this.rayTerrains.find((candidate) => candidate.shell?.visible === true);
    if (!entry?.shell || !entry.terrain.prepass || !entry.terrain.setPrepass) return;
    const renderer = this.engine.renderer as unknown as {
      domElement?: { width: number; height: number };
      getRenderTarget(): unknown; setRenderTarget(target: unknown): void; getClearColor(target: Color): Color; getClearAlpha(): number;
      setClearColor(color: Color | number, alpha: number): void; render(scene: Scene, camera: unknown): void;
    };
    const scale = this.rayPrepass();
    entry.terrain.setPrepass(scale, renderer.domElement?.width ?? 1, renderer.domElement?.height ?? 1);
    if (scale <= 0 || !this.engine.camera) return;
    this.prepassMesh.geometry = entry.shell.geometry;
    this.prepassMesh.material = entry.terrain.prepass.material;
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(this.prepassClear);
    const previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(entry.terrain.prepass.target);
      renderer.setClearColor(0x000000, 0);
      renderer.render(this.prepassScene, this.engine.camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);
    }
  }

  private applySurface(): void {
    const drawn = this.bodyDrawn() && this.webGpuOk();
    if (this.mesh) this.mesh.visible = drawn && this.surface() === 'sphere';
    for (const entry of this.rayTerrains) if (entry.shell) entry.shell.visible = drawn && this.surface() === entry.surface;
    this.meshB.mesh.visible = drawn && this.surface() === 'mesh-b';
  }

  /** Starts contender B's rebuild when it is drawn and something changed; one at a time. */
  private updateMeshB(): Promise<void> {
    if (!this.meshB.mesh.visible) return Promise.resolve();
    this.meshBUpdate ??= this.meshB.update(this.engine.renderer as unknown as Parameters<MeshTerrainUpdate>[0])
      .then(() => {
        const stats = this.meshB.stats;
        if (stats) {
          this.meshBLabel.set(`${stats.leaves} shell leaves, ${Math.round(stats.triangles / 1000)}k triangles; zone level ${stats.zoneLevel}, `
            + `${stats.zoneLeaves} leaves a side, ${Math.round(stats.zoneTriangles / 1000)}k triangles; `
            + `select ${stats.selectMs.toFixed(0)} ms, scan ${stats.scanMs.toFixed(0)} ms, assemble ${stats.assembleMs.toFixed(0)} ms.`);
        }
      })
      .catch((error: unknown) => { this.engineError ||= `contender B: ${String(error)}`; })
      .finally(() => { this.meshBUpdate = undefined; });
    return this.meshBUpdate;
  }

  private shellGeometry(terrain: RaymarchTerrain, radiusM: number) {
    return createCameraRelativeSphereGeometry(terrain.shellRadiusM(radiusM, SHELL_SEGMENTS.height), SHELL_SEGMENTS.width, SHELL_SEGMENTS.height);
  }

  /** Radians per drawing-buffer pixel at the screen centre: the march's hit tolerance. Numbers only, every frame. */
  private updatePixelAngle(): void {
    const camera = this.engine.camera;
    const height = (this.engine.renderer as unknown as { domElement?: { height: number } }).domElement?.height ?? 0;
    if (camera instanceof PerspectiveCamera && height > 0) {
      const angle = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height;
      for (const entry of this.rayTerrains) entry.terrain.setPixelAngle(angle);
      this.meshB.setPixelAngle(angle);
    }
  }

  onTestProgress(progress: TestProgress | null): void {
    this.runnerBusy.set(progress !== null);
  }

  /** One orthographic shadow frustum around the whole body; the shadow pass cost is what the `shadows` feature measures. */
  private configureShadow(radius: number): void {
    const shadow = this.sun.shadow.camera as OrthographicCamera;
    shadow.left = shadow.bottom = -radius * 1.05;
    shadow.right = shadow.top = radius * 1.05;
    shadow.near = radius * 0.5;
    shadow.far = radius * 3.5;
    shadow.updateProjectionMatrix();
    this.sun.shadow.normalBias = radius * 0.002;
  }

  private resolvePose(): void {
    if (this.freeCamera()) {
      this.freeView = zoomCameraView(this.freeView, 0, this.bodyId());
      this.pose = resolveCameraView(this.freeView, this.bodyId(), 'free', this.morph());
      this.freeAltitudeLabel.set(formatAltitude(this.pose.altitudeM));
    } else {
      this.pose = resolveCameraPose(this.poseId(), this.bodyId(), this.morph());
    }
    this.sphere.setCameraBodyPosition(...this.pose.position);
    for (const entry of this.rayTerrains) entry.terrain.setCamera(...this.pose.position);
    this.meshB.setCamera(...this.pose.position);
    const camera = this.engine.camera;
    // A little wider than the screen, so the probe's view (16:9) and a turn of the head stay inside the drawn leaves.
    if (camera instanceof PerspectiveCamera) {
      this.meshB.setView({ forward: this.pose.forward, up: this.pose.up, fovDeg: camera.fov * 1.1, aspect: Math.max(camera.aspect, 16 / 9) * 1.1 });
    }
    this.upVector.set(...this.pose.up);
    this.backward.set(...this.pose.forward).negate();
    this.right.crossVectors(this.upVector, this.backward).normalize();
    this.basis.makeBasis(this.right, this.upVector, this.backward);
    this.cameraQuaternion.setFromRotationMatrix(this.basis);
    this.cameraDirty = true;
  }

  /** The camera stays at the render origin; only its orientation and clip range come from the pose. */
  private updateCamera(): void {
    const camera = this.engine.camera;
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(this.cameraQuaternion);
    if (camera instanceof PerspectiveCamera) {
      // Compare numbers, not a built string: this runs every frame, inside the measurement window.
      if (this.cameraDirty || camera.near !== this.pose.near || camera.far !== this.pose.far) {
        camera.near = this.pose.near;
        camera.far = this.pose.far;
        camera.updateProjectionMatrix();
      }
    }
    camera.updateMatrixWorld();
    this.cameraDirty = false;
  }

  /** The planet's centre sits at minus the camera's body position in render space; the light and its shadow follow it. */
  private updateSun(): void {
    const radius = bodyById(this.bodyId()).radiusM;
    const [cx, cy, cz] = this.pose.position;
    const sun = sunDirectionBody(this.spinAngle, this.sunDirection);
    for (const entry of this.rayTerrains) entry.terrain.setSun(sun[0], sun[1], sun[2]);
    this.meshB.setSun(sun[0], sun[1], sun[2]);
    this.sun.target.position.set(-cx, -cy, -cz);
    this.sun.position.set(-cx + sun[0] * radius * 2, -cy + sun[1] * radius * 2, -cz + sun[2] * radius * 2);
    this.sun.target.updateMatrixWorld();
  }

  private applyFeatures(): void {
    if (!this.mesh) return;
    // Shadow choice (Plan 055 morph contract): the engine's shadow pass does not morph, so the sphere neither casts nor
    // receives while morph > 0 (the whole shadow pass is skipped), rather than morphing the shadow geometry.
    // The raymarched terrain has no shadow pass yet, so it draws without one rather than with the hidden sphere's.
    const shadows = shadowsActive(this.featureState(), this.morph()) && this.surface() === 'sphere';
    // Terrain v2 marches its own soft shadow instead.
    for (const entry of this.rayTerrains) entry.terrain.setShadows?.(this.featureState().shadows);
    if (this.mesh.receiveShadow !== shadows || this.sun.castShadow !== shadows) this.sphere.material.needsUpdate = true;
    this.sun.castShadow = shadows;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
  }

  /**
   * Draws the current view twice into a float target with the probe material (distance in red, u/v in green/blue, drawn flag in alpha) and
   * reads both back. Each draw is synchronous between engine frames, with the renderer's target and clear restored at
   * once, so the screen never shows it. Its own scene holds only the body, sharing the on-screen mesh's geometry.
   */
  private async qualityProbe(): Promise<PlanetShapeQualityProbe> {
    if (!this.mesh) throw new Error('No planet mesh (WebGPU unavailable)');
    const { width, height } = QUALITY_PROBE_SIZE;
    const fovDeg = this.engine.camera instanceof PerspectiveCamera ? this.engine.camera.fov : 60;
    if (!this.probe) {
      const scene = new Scene();
      const mesh = new Mesh(this.mesh.geometry, this.sphere.probeMaterial);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.probe = { target: new RenderTarget(width, height, { type: FloatType, depthBuffer: true }), camera: new PerspectiveCamera(), scene, mesh };
    }
    const { target, camera, scene, mesh } = this.probe;
    mesh.geometry = this.mesh.geometry;
    this.aimProbeCamera(camera, fovDeg, width / height);
    const frame = async (): Promise<QualityFrame> => frameFromProbeRgba(await this.drawOffscreen(scene, camera, target, width, height), width, height);
    const first = await frame();
    const second = await frame();
    return {
      frames: [first, second],
      camera: { position: this.pose.position, forward: this.pose.forward, up: this.pose.up, fovDeg, near: this.pose.near, far: this.pose.far },
      radiusM: bodyById(this.bodyId()).radiusM,
      segments: SPHERE_SEGMENTS,
    };
  }

  /**
   * Draws terrain v2 of the current view into a float target with its depth probes (distance in red, ran-out flag in
   * green, ground in alpha): the fast march twice, then the reference march, each read back before the next. The pixel
   * angle is the probe's while it draws, and the screen's again after. With contender B on screen, B's mesh is the fast
   * frame (twice), still judged by terrain v2's reference march of the same field.
   */
  private async terrainProbe(): Promise<PlanetShapeTerrainProbe> {
    const entry = this.rayTerrains.find((candidate) => candidate.surface === 'raymarch-lit');
    const probes = entry?.terrain.depthProbe;
    if (!entry?.shell || !probes) throw new Error('No terrain v2 depth probe (WebGPU unavailable)');
    const { width, height } = TERRAIN_PROBE_SIZE;
    const fovDeg = this.engine.camera instanceof PerspectiveCamera ? this.engine.camera.fov : 60;
    if (!this.terrainProbeParts) {
      const scene = new Scene();
      const mesh = new Mesh(entry.shell.geometry, probes.fast);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.terrainProbeParts = { target: new RenderTarget(width, height, { type: FloatType, depthBuffer: true }), camera: new PerspectiveCamera(), scene, mesh };
    }
    const { target, camera, scene, mesh } = this.terrainProbeParts;
    const contenderB = this.surface() === 'mesh-b';
    if (contenderB) await this.updateMeshB();
    this.aimProbeCamera(camera, fovDeg, width / height);
    const pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / height;
    const frame = async (material: typeof probes.fast): Promise<TerrainDepthFrame> => {
      const drawsB = material === this.meshB.probeMaterial;
      mesh.geometry = drawsB ? this.meshB.mesh.geometry : entry.shell!.geometry;
      if (drawsB) mesh.position.copy(this.meshB.mesh.position);
      else mesh.position.set(0, 0, 0);
      this.meshB.setProbePixelAngle(pixelAngle);
      mesh.material = material;
      // A new material's pipeline compiles in the background and the draw is skipped until it is ready: every pixel
      // writes a distance (sky too), so an all-zero target means nothing was drawn yet.
      const began = performance.now();
      while (true) {
        entry.terrain.setPixelAngle(pixelAngle);
        const rgba = this.drawOffscreen(scene, camera, target, width, height);
        this.updatePixelAngle();
        const pixels = await rgba;
        if (pixels.some((value, i) => i % 4 === 0 && value !== 0)) return terrainFrameFromRgba(pixels, width, height);
        if (performance.now() - began > TERRAIN_PROBE_COMPILE_MS) throw new Error(`Terrain probe drew nothing for ${TERRAIN_PROBE_COMPILE_MS / 1000} s`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };
    const fastMaterial = contenderB ? this.meshB.probeMaterial : probes.fast;
    const fast = await frame(fastMaterial);
    const again = await frame(fastMaterial);
    const reference = await frame(probes.reference);
    const stats = contenderB ? this.meshB.stats : undefined;
    return {
      fast, again, reference, pixelAngle,
      camera: { position: this.pose.position, forward: this.pose.forward, up: this.pose.up, fovDeg, near: this.pose.near, far: this.pose.far },
      ...(stats ? { contender: { ...stats } } : {}),
    };
  }

  /** Points an offscreen probe camera like the screen's: at the origin, the pose's orientation and clip range. */
  private aimProbeCamera(camera: PerspectiveCamera, fovDeg: number, aspect: number): void {
    camera.fov = fovDeg;
    camera.aspect = aspect;
    camera.near = this.pose.near;
    camera.far = this.pose.far;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(this.cameraQuaternion);
    camera.updateMatrixWorld();
  }

  /**
   * Draws `scene` into the float `target`, cleared to zero, synchronously between engine frames with the renderer's
   * target and clear restored at once (so the screen never shows it), then reads it back.
   */
  private drawOffscreen(scene: Scene, camera: PerspectiveCamera, target: RenderTarget, width: number, height: number): Promise<Float32Array> {
    const renderer = this.engine.renderer as unknown as {
      getRenderTarget(): RenderTarget | null; setRenderTarget(target: RenderTarget | null): void;
      getClearColor(target: Color): Color; getClearAlpha(): number; setClearColor(color: Color | number, alpha: number): void;
      render(scene: Scene, camera: PerspectiveCamera): void;
      readRenderTargetPixelsAsync(target: RenderTarget, x: number, y: number, width: number, height: number): Promise<ArrayBufferView>;
    };
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new Color());
    const previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);
    }
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Promise<Float32Array>;
  }

  private refreshHud(renderer: GpuAdapterRendererLike): void {
    const info = describeGpuAdapter(renderer, globalThis.devicePixelRatio ?? 1);
    const backend = String(info['backend']);
    const width = Number(info['canvas.drawingBufferWidth']);
    const height = Number(info['canvas.drawingBufferHeight']);
    const previous = this.hud();
    const adapter = adapterLabel(info);
    if (backend === previous.backend && width === previous.width && height === previous.height && adapter === previous.adapter) {
      if (!this.runnerReady() && this.webGpuOk() && this.warmTerrain()) this.runnerReady.set(true);
      return;
    }
    this.hud.set({
      backend, width, height, dpr: Number(info['devicePixelRatio']), adapter, software: info['gpu.software'] === true,
      matchesReference: width === REFERENCE_DRAWING_BUFFER.width && height === REFERENCE_DRAWING_BUFFER.height,
    });
    if (backend !== 'webgpu' && this.webGpuOk()) {
      this.webGpuOk.set(false);
      this.webGpuReason.set(`The renderer started on ${backend} instead.`);
      this.setBodyDrawn(false);
    }
    this.runnerReady.set(this.webGpuOk() && this.warmTerrain());
  }

  /**
   * Compiles the raymarch pipeline once, in the background, and says whether it is done. Its first use otherwise
   * stalls the GPU long enough for the timestamp readback to time out inside a test case.
   */
  private warmTerrain(): boolean {
    if (this.terrainCompile === 'pending' && this.mesh) {
      this.terrainCompile = 'running';
      const renderer = this.engine.renderer as unknown as { compileAsync(object: Mesh, camera: unknown, scene: Scene): Promise<void> };
      // `compileAsync` skips hidden objects while it collects them, which happens before its first await.
      const done = Promise.all(this.rayTerrains.map(({ shell }) => {
        if (!shell) return Promise.resolve();
        const visible = shell.visible;
        shell.visible = true;
        const compiled = renderer.compileAsync(shell, this.engine.camera, this.engine.scene);
        shell.visible = visible;
        return compiled;
      }));
      done.then(() => { this.terrainCompile = 'done'; }, (error: unknown) => { this.engineError ||= `terrain compile: ${String(error)}`; this.terrainCompile = 'done'; });
    }
    return this.terrainCompile === 'done';
  }

  private environment(): Record<string, TestSetting> {
    const renderer = this.engine.renderer as unknown as GpuAdapterRendererLike;
    const info = describeGpuAdapter(renderer, globalThis.devicePixelRatio ?? 1);
    const width = Number(info['canvas.drawingBufferWidth']);
    const height = Number(info['canvas.drawingBufferHeight']);
    return {
      page: 'planet-shape-lab',
      renderer: renderer.constructor?.name ?? 'unknown',
      requestedBackend: 'WebGPU',
      ...info,
      'reference.drawingBuffer': `${REFERENCE_DRAWING_BUFFER.width}x${REFERENCE_DRAWING_BUFFER.height}`,
      'reference.drawingBufferMatches': width === REFERENCE_DRAWING_BUFFER.width && height === REFERENCE_DRAWING_BUFFER.height,
      'gpu.powerPreference': POWER_PREFERENCE,
      gpuTimingSource: 'engine gpuTiming: WebGPU timestamps per render pass (FrameSampler gpuPasses) plus the whole-render median',
      sphereSegments: `${SPHERE_SEGMENTS.width}x${SPHERE_SEGMENTS.height}`,
      frame: BODY_FRAME_NOTE,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    };
  }
}
