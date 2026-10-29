import { Component, DestroyRef, computed, inject, isDevMode, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AmbientLight, Color, DirectionalLight, InstancedBufferGeometry, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, RenderTarget, Scene, SphereGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { TerrainPlanetMaterial } from 'triangular-engine/lod-surface';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import {
  POSES, biomePathView, lookView, panView, poseView, resolveCamera, sweepPathView, turnPathView, zoomPathView, zoomView, type CameraView, type PoseId,
  type ResolvedCamera,
} from './lod-camera';
import { BACKSTOP_VALUE, countCracks } from './lod-crack-probe';
import {
  CAP_SLACK, DEFAULT_BAKE_K, DOMAIN_PRESETS, HEIGHT_SOURCES, HEIGHT_SOURCE_LABELS, LodSelector, PATCH_CELLS, PIXEL_FLOOR, cellPlanetFor, cellPlanetWorld, createHeightSource, createLodSurfaceMesh,
  createTextureHeightSource, domainPreset, frustumNormals, groundFrame, isBakedSource, percentile, sourceSupports, textureMegabytes, twinErrors, withDetailNoise,
  type BakeLayout, type BakedSourceId, type CellPlanetDescription, type CubeWarp, type DomainPresetId, type HeightSource, type HeightSourceId, type LodDomain, type LodMode,
  type LodSurfaceMesh, type LodView, type PatchCells, type SelectorStats, type SelectorView, type TextureHeightSource,
} from 'triangular-engine/lod-surface/core';
import { bakeInWorker } from './lod-height-bake-client';
import { createLodSurfaceTestAdapter, type LodSurfaceBakeInfo, type LodSurfaceTestHost } from './lod-surface-test-adapter';
import { DEFAULT_SETTINGS, LOD_SURFACE_TEST_HISTORY, type LodSurfaceTestSettings } from './lod-surface-tests';

/**
 * Plan 059 M1: the LOD surface lab. A bounded 100 km plane and cube-spheres of 10 km and 600 km, drawn by one
 * instanced grid whose leaves come from a CPU quadtree re-selected every frame over a persistent node pool
 * (`lod-selector.ts`), cracks closed by edge folding (`lod-surface-mesh.ts`). WebGPU only (Plan 059 D2): without it the page says so and draws nothing.
 *
 * Frames: the domain frame is the render frame; the engine camera sits at the origin and only turns, and every leaf is
 * placed relative to the camera from doubles. Reversed float depth, so 2 cm near planes and orbit views share a buffer.
 */

const LEAF_CAPS = [256, 512, 1024, 2048, 4096, 8192, 16_384] as const;
const FOV_DEG = 60;
/** Leaves shrink by this share of their size when the injected gap is on. */
const GAP_SHARE = 0.01;
const THUMBNAIL_WIDTH = 240;
/** Background colour of the lab. */
const SKY = new Color(0x0b1220);
/** Selection samples kept for the HUD's running mean. */
const HUD_SAMPLES = 60;

/**
 * Baked textures kept (CPU arrays and GPU textures; 25 MB each for six faces at 1025², twice that again on the GPU) so
 * switching back to a source does not bake again. The terrain suite orders its cases source by source and domain by
 * domain, so one pass bakes each combination once with this; a second repetition bakes again.
 */
const BAKE_CACHE = 2;
/** Texture sizes offered for baked sources: 2^k texel cells per face side. */
const BAKE_SIZES = [10, 11] as const;

/** `?material=planet` starts the lab with the planet material. */
function initialSurfaceMaterial(): SurfaceMaterialId {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('material') === 'planet' ? 'planet' : 'debug';
  } catch {
    return 'debug';
  }
}

const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

/** Surface materials of the lab: the built-in debug material, or the cell-planet `TerrainPlanetMaterial` (Plan 059 G3). Not a test setting. */
type SurfaceMaterialId = 'debug' | 'planet';

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
  getPixelRatio?(): number;
}

@Component({
  standalone: true,
  selector: 'app-lod-surface-lab-page',
  imports: [EngineModule, RouterLink, TestRunnerComponent],
  providers: [
    EngineService.provide({
      showFPS: true,
      gpuTiming: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, trackTimestamp: true, reversedDepthBuffer: true },
    }),
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
        <p>The LOD surface lab draws with the WebGPU renderer only (Plan 059 D2). {{ webGpuReason() }}</p>
        <a routerLink="/">← Examples</a>
      </div>
    }

    <aside class="panel" (pointermove)="$event.stopPropagation()" (wheel)="$event.stopPropagation()">
      <a routerLink="/">← Examples</a>
      <h2>LOD surface lab · Plan 059 M1</h2>
      <p class="hud" data-testid="hud">
        {{ hud().backend }} · {{ hud().width }}×{{ hud().height }} · {{ hud().adapter }}
        @if (hud().software) { <b> · SOFTWARE RENDERER</b> }<br />
        leaves {{ stats().leaves }} (drawn {{ stats().drawn }}) · {{ triangles() }} triangles<br />
        deepest level {{ stats().deepestLevel }} · splits {{ stats().splits }} (+{{ stats().forcedSplits }} balance)
        · this frame on screen +{{ stats().visibleNewSplits }} / -{{ stats().visibleMerges }} (all +{{ stats().newSplits }} / -{{ stats().merges }})
        @if (stats().capHit) { · <b>cap hit, {{ stats().unmet }} unmet</b> }<br />
        selection {{ selectionMs().toFixed(2) }} ms · altitude {{ altitudeLabel() }}
        @if (bakeLine()) { <br />{{ bakeLine() }} }
        @if (probeResult()) { <br />probe: {{ probeResult() }} }
      </p>

      <tri-test-runner
        [suites]="testHistory" [adapter]="testAdapter" [available]="runnerReady()"
        [allowAutoStart]="allowTestAutoStart" [resultSink]="true" (progressChange)="onTestProgress($event)" />
      <p class="note">Keep the tab visible and focused for timing. Headless or software runs are functional evidence only.</p>

      <fieldset class="controls" [disabled]="runnerBusy()">
        <p class="label">Domain</p>
        <p class="row">
          @for (preset of domains; track preset.id) {
            <button (click)="setDomain(preset.id)" [class.active]="domainId() === preset.id">{{ preset.label }}</button>
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
          Free camera (left drag: turn · right or shift drag: move · wheel: altitude)
        </label>

        <p class="label">Height source</p>
        <p class="row">
          @for (id of sources; track id) {
            <button (click)="setSource(id)" [class.active]="sourceId() === id">{{ sourceLabels[id] }}</button>
          }
        </p>
        @if (bakedSelected()) {
          <p class="row">
            baked texture:
            @for (k of bakeSizes; track k) {
              <button (click)="setBakeK(k)" [class.active]="bakeK() === k">{{ 2 ** k + 1 }}²</button>
            }
          </p>
        }

        <p class="label">Criterion</p>
        <p class="row">
          <button (click)="setMode('distance')" [class.active]="mode() === 'distance'">distance</button>
          <button (click)="setMode('fixed')" [class.active]="mode() === 'fixed'">fixed level (uniform baseline)</button>
        </p>
        @if (mode() === 'distance') {
          <p class="row">cell size {{ cellPixels() }} px (floor {{ pixelFloor }} px)
            <input type="range" min="2" max="16" step="1" aria-label="Target cell size in pixels" [value]="cellPixels()" (input)="setCellPixels(+$any($event.target).value)" />
          </p>
          <p class="row">hysteresis {{ hysteresis() === 0 ? 'off' : hysteresis().toFixed(2) }}
            <input type="range" min="0" max="0.5" step="0.05" aria-label="Split and merge hysteresis" [value]="hysteresis()" (input)="setHysteresis(+$any($event.target).value)" />
          </p>
        } @else {
          <p class="row">level {{ fixedLevel() }}
            <input type="range" min="0" max="10" step="1" aria-label="Fixed level" [value]="fixedLevel()" (input)="setFixedLevel(+$any($event.target).value)" />
          </p>
        }
        <p class="row">
          leaf cap:
          @for (cap of leafCaps; track cap) {
            <button (click)="setLeafCap(cap)" [class.active]="leafCap() === cap">{{ cap }}</button>
          }
        </p>
        <p class="row">
          patch cells:
          @for (cells of patchCellOptions; track cells) {
            <button (click)="setPatchCells(cells)" [class.active]="patchCells() === cells">{{ cells }}</button>
          }
        </p>
        <label class="feature">
          <input type="checkbox" [checked]="warp() === 'equal-angle'" (change)="setWarp($any($event.target).checked ? 'equal-angle' : 'none')" />
          Equal-angle cube warp (sphere)
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="cull()" (change)="setCull($any($event.target).checked)" />
          Frustum culling (draw only what the camera sees)
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="cullInSelection()" (change)="setCullInSelection($any($event.target).checked)" />
          Legacy: cull inside selection (refine only what the camera sees; flickers on a turn)
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="folding()" (change)="setFolding($any($event.target).checked)" />
          Edge folding (off: the known-bad control)
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="injectedGap() > 0" (change)="setInjectedGap($any($event.target).checked ? gapShare : 0)" />
          Inject a gap (each leaf shrinks 1%; the probe must see it)
        </label>

        <p class="row">detail noise {{ detailNoise() === 0 ? 'off' : (detailNoise() * 100).toFixed(0) + '% of a texel' }}
          <input type="range" min="0" max="0.1" step="0.01" aria-label="Detail noise below the texel size, share of the texel" [value]="detailNoise()" (input)="setDetailNoise(+$any($event.target).value)" />
        </p>

        <p class="label">Surface material (G3 spike)</p>
        <p class="row">
          <button (click)="setSurfaceMaterial('debug')" [class.active]="surfaceMaterial() === 'debug'">debug</button>
          <button (click)="setSurfaceMaterial('planet')" [class.active]="surfaceMaterial() === 'planet'" data-testid="planet-material">planet material</button>
        </p>
        <p class="note">Planet material: the cell-planet look (cell colours by direction, PBR sun). Pick the cell-planet source on a sphere; other sources get a plain green. Not part of any suite.</p>

        <p class="label">Debug view</p>
        <p class="row">
          <button (click)="setView('lod')" [class.active]="view() === 'lod'">LOD colours</button>
          <label><input type="checkbox" [checked]="lighting()" (change)="setLighting($any($event.target).checked)" /> Sun lighting</label>
          <button (click)="setView('shaded')" [class.active]="view() === 'shaded'">shaded</button>
        </p>
        <label class="feature">
          <input type="checkbox" [checked]="bounds()" (change)="setBounds($any($event.target).checked)" /> Patch bounds
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="wireframe()" (change)="setWireframe($any($event.target).checked)" /> Wireframe
        </label>
        <label class="feature">
          <input type="checkbox" [checked]="frozen()" (change)="frozen.set($any($event.target).checked)" /> Freeze selection (fly around the frozen tree)
        </label>
        <p class="row"><button (click)="runProbe()" data-testid="probe">Run the crack probe</button></p>
      </fieldset>
      <p class="note">Pops are allowed in M1 (no blending yet, Plan 059 D5).</p>
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
    .note { opacity: 0.6; margin: 0.5rem 0 0; }
    .feature { display: block; margin: 0.2rem 0; }
    button.active { outline: 2px solid #6cf; }
    .blocker {
      position: absolute; inset: 0; z-index: 30; display: grid; place-content: center; gap: 0.5rem; padding: 2rem;
      background: rgba(5, 8, 12, 0.92); color: #eee; font: 15px/1.5 system-ui; text-align: center;
    }
  `,
})
export class LodSurfaceLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly screenshot = inject(ScreenshotService);
  private readonly destroyRef = inject(DestroyRef);
  readonly domains = DOMAIN_PRESETS;
  readonly poses = POSES;
  readonly sources = HEIGHT_SOURCES;
  readonly sourceLabels = HEIGHT_SOURCE_LABELS;
  readonly bakeSizes = BAKE_SIZES;
  readonly leafCaps = LEAF_CAPS;
  readonly patchCellOptions = PATCH_CELLS;
  readonly pixelFloor = PIXEL_FLOOR;
  readonly gapShare = GAP_SHARE;
  readonly testHistory = LOD_SURFACE_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();

  readonly domainId = signal<DomainPresetId>(DEFAULT_SETTINGS.domain);
  readonly warp = signal<CubeWarp>(DEFAULT_SETTINGS.warp);
  readonly sourceId = signal<HeightSourceId>(DEFAULT_SETTINGS.source);
  readonly patchCells = signal<PatchCells>(DEFAULT_SETTINGS.patchCells);
  readonly mode = signal<LodMode>(DEFAULT_SETTINGS.mode);
  readonly fixedLevel = signal(DEFAULT_SETTINGS.fixedLevel);
  readonly cellPixels = signal(DEFAULT_SETTINGS.cellPixels);
  readonly leafCap = signal(DEFAULT_SETTINGS.leafCap);
  readonly cull = signal(DEFAULT_SETTINGS.cull);
  readonly cullInSelection = signal(false);
  readonly hysteresis = signal(DEFAULT_SETTINGS.hysteresis);
  readonly detailNoise = signal(DEFAULT_SETTINGS.detailNoise);
  readonly folding = signal(DEFAULT_SETTINGS.folding);
  readonly injectedGap = signal(DEFAULT_SETTINGS.injectedGap);
  readonly poseId = signal<PoseId>(DEFAULT_SETTINGS.pose);
  readonly view = signal<LodView>(DEFAULT_SETTINGS.view);
  readonly wireframe = signal(DEFAULT_SETTINGS.wireframe);
  readonly bounds = signal(DEFAULT_SETTINGS.bounds);
  readonly lighting = signal(DEFAULT_SETTINGS.lighting);
  /** Baked texture size: 2^k texel cells per face side (not a test setting; the suites use the default). */
  readonly bakeK = signal<number>(DEFAULT_BAKE_K);
  readonly bakeStatus = signal('');
  readonly bakeInfo = signal<LodSurfaceBakeInfo | undefined>(undefined);
  readonly bakedSelected = computed(() => isBakedSource(this.sourceId()));
  readonly bakeLine = computed(() => {
    const info = this.bakeInfo();
    if (this.bakeStatus() && this.bakeStatus() !== 'ready') return this.bakeStatus();
    if (!info) return '';
    const perFace = info.bakeMsPerFace.map((ms) => ms.toFixed(0)).join('/');
    const upload = info.uploadMs === null ? 'n/a' : `${info.uploadMs.toFixed(1)} ms`;
    const world = info.worldBuildMs === undefined ? '' : `world ${info.worldBuildMs.toFixed(0)} ms, `;
    return `${info.source} ${info.side}² x ${info.faces}: ${world}bake ${perFace} ms per face (+${info.pyramidMs.toFixed(0)} pyramid, ${info.roundTripMs.toFixed(0)} round trip) · upload ${upload} · ${info.textureMB.toFixed(1)} MB · twin vs source max ${maxOf(info.twinErrorM).toFixed(2)} m, p95 ${percentile(info.twinErrorM, 0.95).toFixed(2)} m`;
  });
  /** Which material draws the surface. Start with `?material=planet` in the URL. */
  readonly surfaceMaterial = signal<SurfaceMaterialId>(initialSurfaceMaterial());
  readonly freeCamera = signal(false);
  readonly frozen = signal(false);

  readonly webGpuOk = signal(typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu);
  readonly webGpuReason = signal(this.webGpuOk() ? '' : 'This browser exposes no navigator.gpu.');
  readonly runnerReady = signal(false);
  readonly runnerBusy = signal(false);
  readonly hud = signal({ backend: 'starting', width: 0, height: 0, adapter: 'adapter unknown', software: false });
  readonly stats = signal<SelectorStats>({ leaves: 0, drawn: 0, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 });
  readonly selectionMs = signal(0);
  readonly altitudeLabel = signal('');
  readonly probeResult = signal('');
  readonly triangles = computed(() => (this.stats().drawn * 2 * this.patchCells() ** 2).toLocaleString('en-US'));

  private domain: LodDomain = domainPreset(DEFAULT_SETTINGS.domain, DEFAULT_SETTINGS.warp);
  private source: HeightSource = createHeightSource(DEFAULT_SETTINGS.source, 'sphere');
  private selector: LodSelector | undefined;
  private surface: LodSurfaceMesh | undefined;
  private builtKey = '';
  /** The planet material and its cell lookup, kept while the cell planet is the source (the lookup costs a world build and an atlas). */
  private planetMaterial: { readonly material: TerrainPlanetMaterial; readonly key: string } | undefined;
  private sunLight: DirectionalLight | undefined;
  private ambientLight: AmbientLight | undefined;
  /** Key of the bake being waited for, or '' when none (the drawn surface is then the one the settings name). */
  private pendingBake = '';
  private activeBake = '';
  private readonly bakes = new Map<string, { source: TextureHeightSource; info: LodSurfaceBakeInfo }>();
  private freeView: CameraView = poseView(DEFAULT_SETTINGS.pose, this.domain);
  private zoomProgress: number | undefined;
  /** Seconds into the scripted sweep of the named pose, or undefined when no sweep runs. */
  private sweepTime: number | undefined;
  /** Seconds into the scripted turn (heading only) of the named pose, or undefined when no turn runs. */
  private turnTime: number | undefined;
  private biomeMotion = false;
  private camera: ResolvedCamera | undefined;
  private drag: { pointerId: number; look: boolean } | undefined;
  private readonly frustum = new Float64Array(12);
  /** The view handed to the selector every frame, rewritten in place (no per-frame allocation). */
  private readonly selectorView: { -readonly [K in keyof SelectorView]: SelectorView[K] } = { camera: [0, 0, 0], pixelAngle: 0, frustum: this.frustum };
  private readonly basis = new Matrix4();
  private readonly axes = [new Vector3(), new Vector3(), new Vector3()] as const;
  private renderedFrames = 0;
  private engineError = '';
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private readonly hudSamples: number[] = [];
  private selectionSamples: number[] = [];
  private selectOnlySamples: number[] = [];
  private uploadOnlySamples: number[] = [];
  private leafSamples: number[] = [];
  private levelChangeSamples: number[] = [];
  private levelChangeAllSamples: number[] = [];
  private readonly renderCallbacks = new Set<(renderedAt: number) => void>();
  private probeParts: { target: RenderTarget; scene: Scene; surface: Mesh; backstop: Mesh; backstopMaterial: MeshBasicNodeMaterial } | undefined;

  private readonly testHost: LodSurfaceTestHost = {
    read: () => this.readSettings(),
    apply: (settings) => this.applySettings(settings),
    renderedFrames: () => this.renderedFrames,
    errors: () => this.engineError,
    resetErrors: () => { this.engineError = ''; },
    backendIsWebGpu: () => this.webGpuOk() && this.hud().backend === 'webgpu',
    heightSourceReady: () => this.pendingBake === '',
    frame: () => ({
      stats: { ...(this.selector?.stats ?? this.stats()) },
      instances: (this.surface?.mesh.geometry as InstancedBufferGeometry | undefined)?.instanceCount ?? 0,
      trianglesPerLeaf: 2 * this.patchCells() ** 2,
      drawCalls: this.lastDrawCalls,
      rendererTriangles: this.lastTriangles,
      drawingBuffer: [this.hud().width, this.hud().height],
      ...(this.bakeInfo() && this.activeBake ? { bake: this.bakeInfo() } : {}),
    }),
    onRenderComplete: (callback) => { this.renderCallbacks.add(callback); return () => this.renderCallbacks.delete(callback); },
    selectionSamples: () => this.selectionSamples,
    selectOnlySamples: () => this.selectOnlySamples,
    uploadOnlySamples: () => this.uploadOnlySamples,
    leafSamples: () => this.leafSamples,
    levelChangeSamples: () => this.levelChangeSamples,
    levelChangeAllSamples: () => this.levelChangeAllSamples,
    resetSamples: () => { this.selectionSamples = []; this.selectOnlySamples = []; this.uploadOnlySamples = []; this.leafSamples = []; this.levelChangeSamples = []; this.levelChangeAllSamples = []; },
    setZoomProgress: (t) => { this.zoomProgress = t; },
    setSweepTime: (seconds) => { this.sweepTime = seconds; },
    setTurnTime: (seconds) => { this.turnTime = seconds; },
    isSampling: () => this.engine.fpsController.frameSampler.isActive,
    startSampling: () => this.engine.fpsController.frameSampler.start(),
    gpuSamplesSoFar: () => this.engine.fpsController.frameSampler.gpuSamples,
    stopSampling: () => this.engine.fpsController.frameSampler.stop(),
    crackProbe: () => this.crackProbe(),
    environment: () => this.environment(),
    thumbnail: () => this.screenshot.capture({
      engine: this.engine, format: 'image/webp', quality: 0.6,
      compress: { maxWidthOrHeight: THUMBNAIL_WIDTH, fileType: 'image/webp', quality: 0.6 },
    }),
  };
  readonly testAdapter: TestRunAdapter<LodSurfaceTestSettings, LodSurfaceTestSettings> = createLodSurfaceTestAdapter(this.testHost);

  constructor() {
    const errors = this.engine.error$.subscribe((event) => { this.engineError ||= `${event.phase}: ${String(event.error)}`; });
    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera) camera.fov = FOV_DEG;
    this.engine.scene.background = SKY;
    if (this.webGpuOk()) this.rebuild();
    const tick = this.engine.tick$.subscribe(() => this.update());
    const rendered = this.engine.renderComplete$.subscribe(({ renderedAt }) => {
      this.renderedFrames++;
      const renderer = this.engine.renderer as unknown as RendererLike;
      this.lastDrawCalls = renderer.info?.render.drawCalls ?? 0;
      this.lastTriangles = renderer.info?.render.triangles ?? 0;
      if (this.renderedFrames % 30 === 1) this.refreshHud(renderer);
      for (const callback of this.renderCallbacks) callback(renderedAt);
    });
    this.destroyRef.onDestroy(() => {
      this.runnerReady.set(false);
      errors.unsubscribe();
      tick.unsubscribe();
      rendered.unsubscribe();
      if (this.surface) {
        this.engine.scene.remove(this.surface.mesh);
        this.surface.dispose();
      }
      this.disposePlanetMaterial();
      this.setPlanetLights(false);
      this.pendingBake = '';
      for (const { source } of this.bakes.values()) source.dispose();
      this.bakes.clear();
      if (this.probeParts) {
        this.probeParts.target.dispose();
        this.probeParts.backstop.geometry.dispose();
        this.probeParts.backstopMaterial.dispose();
      }
    });
  }

  setDomain(id: DomainPresetId): void {
    this.domainId.set(id);
    this.rebuild();
    this.freeView = poseView(this.poseId(), this.domain);
  }

  setPose(id: PoseId): void {
    this.freeCamera.set(false);
    this.drag = undefined;
    this.poseId.set(id);
  }

  setFreeCamera(on: boolean): void {
    if (on) this.freeView = poseView(this.poseId(), this.domain);
    this.freeCamera.set(on);
    this.drag = undefined;
  }

  setSource(id: HeightSourceId): void { this.sourceId.set(id); if (id === 'biome-mix') this.setLighting(true); this.rebuild(); }
  setBakeK(k: number): void { this.bakeK.set(k); this.rebuild(); }
  setMode(mode: LodMode): void { this.mode.set(mode); this.rebuild(); }
  setFixedLevel(level: number): void { this.fixedLevel.set(level); this.rebuild(); }
  setCellPixels(pixels: number): void { this.cellPixels.set(Math.max(PIXEL_FLOOR, pixels)); this.rebuild(); }
  setLeafCap(cap: number): void { this.leafCap.set(cap); this.rebuild(); }
  setPatchCells(cells: PatchCells): void { this.patchCells.set(cells); this.rebuild(); }
  setWarp(warp: CubeWarp): void { this.warp.set(warp); this.rebuild(); }
  setCull(on: boolean): void { this.cull.set(on); this.rebuild(); }
  setCullInSelection(on: boolean): void { this.cullInSelection.set(on); this.rebuild(); }
  setHysteresis(ratio: number): void { this.hysteresis.set(Math.max(0, ratio)); this.rebuild(); }
  setFolding(on: boolean): void { this.folding.set(on); this.surface?.setFolding(on); }
  setInjectedGap(share: number): void { this.injectedGap.set(share); this.surface?.setInjectedGap(share); }
  setView(view: LodView): void { this.view.set(view); this.surface?.setView(view); }
  setDetailNoise(share: number): void { this.detailNoise.set(Math.max(0, share)); this.rebuild(); }
  setLighting(on: boolean): void { this.lighting.set(on); this.surface?.setLighting(on); }
  setBounds(on: boolean): void { this.bounds.set(on); this.surface?.setBounds(on); }
  setWireframe(on: boolean): void { this.wireframe.set(on); this.surface?.setWireframe(on); }
  setSurfaceMaterial(id: SurfaceMaterialId): void { this.surfaceMaterial.set(id); this.rebuild(); }

  async runProbe(): Promise<void> {
    const result = await this.crackProbe();
    this.probeResult.set(`${result.cracks} crack px (${result.masked} outline px masked) at ${result.width}×${result.height}`);
  }

  onTestProgress(progress: TestProgress | null): void {
    this.runnerBusy.set(progress !== null);
    if (progress !== null) {
      this.freeCamera.set(false);
      this.drag = undefined;
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.freeCamera() || this.runnerBusy() || this.fromPanel(event)) return;
    this.drag = { pointerId: event.pointerId, look: !(event.button === 2 || event.shiftKey) };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const height = Math.max(1, (event.currentTarget as HTMLElement).clientHeight);
    const dx = event.movementX / height;
    const dy = event.movementY / height;
    this.freeView = this.drag.look ? lookView(this.freeView, dx, dy) : panView(this.freeView, dx, dy, this.domain);
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.drag = undefined;
  }

  onWheel(event: WheelEvent): void {
    if (!this.freeCamera() || this.runnerBusy() || this.fromPanel(event)) return;
    event.preventDefault();
    this.freeView = zoomView(this.freeView, Math.sign(event.deltaY), this.domain);
  }

  onContextMenu(event: MouseEvent): void {
    if (this.freeCamera() && !this.fromPanel(event)) event.preventDefault();
  }

  private fromPanel(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.panel, .blocker') !== null;
  }

  private readSettings(): LodSurfaceTestSettings {
    return {
      domain: this.domainId(), warp: this.warp(), source: this.sourceId(), patchCells: this.patchCells(), mode: this.mode(),
      fixedLevel: this.fixedLevel(), cellPixels: this.cellPixels(), leafCap: this.leafCap(), cull: this.cull(), ...(this.cullInSelection() ? { cullInSelection: true } : {}), hysteresis: this.hysteresis(), folding: this.folding(),
      injectedGap: this.injectedGap(), pose: this.poseId(), view: this.view(), wireframe: this.wireframe(), bounds: this.bounds(), lighting: this.lighting(), detailNoise: this.detailNoise(),
      ...(this.zoomProgress !== undefined ? { motion: this.biomeMotion ? 'biome-sweep' as const : 'zoom' as const } : this.sweepTime !== undefined ? { motion: 'sweep' as const } : this.turnTime !== undefined ? { motion: 'turn' as const } : {}),
    };
  }

  private applySettings(settings: LodSurfaceTestSettings): void {
    this.domainId.set(settings.domain);
    this.warp.set(settings.warp);
    this.sourceId.set(settings.source);
    this.setLighting(settings.lighting);
    this.detailNoise.set(settings.detailNoise);
    this.patchCells.set(settings.patchCells);
    this.mode.set(settings.mode);
    this.fixedLevel.set(settings.fixedLevel);
    this.cellPixels.set(settings.cellPixels);
    this.leafCap.set(settings.leafCap);
    this.cull.set(settings.cull);
    this.cullInSelection.set(settings.cullInSelection === true);
    this.hysteresis.set(settings.hysteresis);
    this.frozen.set(false);
    this.rebuild();
    this.setFolding(settings.folding);
    this.setInjectedGap(settings.injectedGap);
    this.setView(settings.view);
    this.setWireframe(settings.wireframe);
    this.setBounds(settings.bounds);
    this.setPose(settings.pose);
    this.biomeMotion = settings.motion === 'biome-sweep';
    this.zoomProgress = settings.motion === 'zoom' || this.biomeMotion ? 0 : undefined;
    this.sweepTime = settings.motion === 'sweep' ? 0 : undefined;
    this.turnTime = settings.motion === 'turn' ? 0 : undefined;
  }

  /**
   * Makes the selector and, when its shader inputs changed, the surface mesh for the current settings. A baked source that
   * is not ready yet starts its bake and returns: the surface drawn stays as it was until the bake finishes and calls this
   * again, which then reads every setting afresh.
   */
  private rebuild(): void {
    if (!this.webGpuOk()) return;
    const domain = domainPreset(this.domainId(), this.warp());
    const source = this.resolveSource(domain);
    if (!source) return;
    const sizeChanged = domain.kind !== this.domain.kind || domain.sizeM !== this.domain.sizeM;
    this.domain = domain;
    // The selector and the camera see the noise through the source (heights, bound and node ranges); the mesh adds it in the vertex stage.
    this.source = withDetailNoise(source, { domain, cells: 2 ** this.bakeK(), share: this.detailNoise() });
    if (sizeChanged) this.freeView = poseView(this.poseId(), this.domain);
    this.selector = new LodSelector({
      domain: this.domain, patchCells: this.patchCells(), mode: this.mode(), fixedLevel: this.fixedLevel(), cellPixels: this.cellPixels(),
      leafCap: this.leafCap(), heightBoundM: this.source.boundM, cull: this.cull(), cullInSelection: this.cullInSelection(), hysteresis: this.hysteresis(),
      ...(this.source.nodeRange ? { heightRanges: { nodeRange: this.source.nodeRange.bind(this.source) } } : {}),
    });
    const capacity = this.leafCap() + CAP_SLACK + 6;
    const planetMaterial = this.surfaceMaterial() === 'planet' ? this.planetMaterialFor(domain) : undefined;
    this.setPlanetLights(planetMaterial !== undefined);
    const key = [this.domainId(), this.warp(), this.sourceId(), this.activeBake, this.patchCells(), capacity, this.detailNoise() > 0, this.bakeK(), planetMaterial?.key ?? 'debug'].join('|');
    if (key === this.builtKey && this.surface) {
      this.surface.setDetailNoise(this.detailNoise());
      return;
    }
    if (this.surface) {
      this.engine.scene.remove(this.surface.mesh);
      this.surface.dispose();
    }
    this.surface = createLodSurfaceMesh({
      domain: this.domain, patchCells: this.patchCells(), source: this.source, capacity,
      ...(this.detailNoise() > 0 ? { detail: { cells: 2 ** this.bakeK() } } : {}),
      ...(planetMaterial ? { material: planetMaterial.material } : {}),
    });
    this.surface.setFolding(this.folding());
    this.surface.setInjectedGap(this.injectedGap());
    this.surface.setView(this.view());
    this.surface.setBounds(this.bounds());
    this.surface.setLighting(this.lighting());
    this.surface.setDetailNoise(this.detailNoise());
    this.surface.setWireframe(this.wireframe());
    this.engine.scene.add(this.surface.mesh);
    this.builtKey = key;
  }

  /**
   * The planet material for the current source: on the cell planet (a sphere) it paints the world's cells (the same world the
   * heights come from) through `TerrainPlanetMaterial`'s `cellPlanet` option; otherwise it is a plain colour. Kept between
   * rebuilds while its key (source, radius) is unchanged.
   */
  private planetMaterialFor(domain: LodDomain): { readonly material: TerrainPlanetMaterial; readonly key: string } {
    const cellPlanet = this.sourceId() === 'cell-planet' && domain.kind === 'sphere';
    const key = cellPlanet ? `planet-cells-${domain.sizeM}` : 'planet-plain';
    if (this.planetMaterial?.key === key) return this.planetMaterial;
    this.disposePlanetMaterial();
    const material = new TerrainPlanetMaterial(cellPlanet ? { cellPlanet: cellPlanetWorld(cellPlanetFor(domain.sizeM)).world } : {});
    this.planetMaterial = { material, key };
    return this.planetMaterial;
  }

  private disposePlanetMaterial(): void {
    this.planetMaterial?.material.dispose();
    this.planetMaterial = undefined;
  }

  /** The planet material is lit by scene lights (PBR); the debug material has its own sun. */
  private setPlanetLights(on: boolean): void {
    if (on && !this.sunLight) {
      this.sunLight = new DirectionalLight(0xffffff, 3);
      this.ambientLight = new AmbientLight(0xaabbdd, 0.5);
      this.engine.scene.add(this.sunLight, this.sunLight.target, this.ambientLight);
    } else if (!on && this.sunLight) {
      this.engine.scene.remove(this.sunLight, this.sunLight.target, this.ambientLight!);
      this.sunLight = this.ambientLight = undefined;
    }
  }

  /** The current source for a domain: analytic ones at once, baked ones from the cache or after a bake (then undefined). */
  private resolveSource(domain: LodDomain): HeightSource | undefined {
    const id = this.sourceId();
    if (!isBakedSource(id)) {
      this.pendingBake = '';
      this.activeBake = '';
      this.bakeStatus.set('');
      this.bakeInfo.set(undefined);
      return createHeightSource(id, domain.kind);
    }
    if (!sourceSupports(id, domain.kind)) {
      // No such surface (the cell planet on the plane): draw flat and say so. The suites never ask for it.
      this.pendingBake = '';
      this.activeBake = '';
      this.bakeStatus.set(`${id} needs a sphere: showing flat`);
      this.bakeInfo.set(undefined);
      return createHeightSource('flat', domain.kind);
    }
    const layout: BakeLayout = { kind: domain.kind, warp: domain.warp, sizeM: domain.sizeM, k: this.bakeK() };
    const planet = id === 'cell-planet' ? cellPlanetFor(domain.sizeM) : undefined;
    const key = [id, layout.kind, layout.warp, layout.sizeM, layout.k, ...(planet ? [planet.seed, planet.cellCount, planet.heightScaleM] : [])].join('|');
    const hit = this.bakes.get(key);
    if (hit) {
      this.pendingBake = '';
      this.activeBake = key;
      this.bakeStatus.set('ready');
      this.bakeInfo.set(hit.info);
      return hit.source;
    }
    if (this.pendingBake !== key) {
      this.pendingBake = key;
      this.bakeStatus.set(`baking ${id} ${2 ** layout.k + 1}² x ${domain.kind === 'plane' ? 1 : 6}…`);
      void this.bake(id as BakedSourceId, layout, key, planet);
    }
    return undefined;
  }

  private async bake(id: BakedSourceId, layout: BakeLayout, key: string, planet?: CellPlanetDescription): Promise<void> {
    try {
      const { baked, probes, worldBuildMs, roundTripMs } = await bakeInWorker(id, layout, planet);
      const source = createTextureHeightSource(id, baked);
      // Hand the texture to the renderer now so the upload is timed here, not inside a rendered frame.
      let uploadMs: number | null = null;
      const renderer = this.engine.renderer as unknown as { initTexture?(texture: unknown): void };
      const began = performance.now();
      try {
        renderer.initTexture?.(source.texture);
        uploadMs = performance.now() - began;
      } catch {
        // Not initialised yet: the first frame that draws the surface uploads it.
      }
      const info: LodSurfaceBakeInfo = {
        source: id, side: baked.side, faces: baked.faces, bakeMsPerFace: baked.bakeMsPerFace, pyramidMs: baked.pyramidMs, roundTripMs,
        uploadMs, textureMB: textureMegabytes(baked), twinErrorM: twinErrors(probes, source.heightAtLattice),
        ...(worldBuildMs === undefined ? {} : { worldBuildMs }),
      };
      this.bakes.set(key, { source, info });
      while (this.bakes.size > BAKE_CACHE) {
        const oldest = [...this.bakes.keys()].find((candidate) => candidate !== key && candidate !== this.activeBake);
        if (oldest === undefined) break;
        this.bakes.get(oldest)?.source.dispose();
        this.bakes.delete(oldest);
      }
      if (this.pendingBake === key) this.rebuild();
    } catch (error) {
      if (this.pendingBake === key) {
        this.pendingBake = '';
        this.bakeStatus.set(`bake failed: ${String(error)}`);
        this.engineError ||= `bake: ${String(error)}`;
      }
    }
  }

  private currentView(): CameraView {
    if (this.zoomProgress !== undefined) return this.biomeMotion ? biomePathView(this.domain, this.zoomProgress) : zoomPathView(this.domain, this.zoomProgress);
    if (this.sweepTime !== undefined) return sweepPathView(this.domain, this.poseId(), this.sweepTime);
    if (this.turnTime !== undefined) return turnPathView(this.domain, this.poseId(), this.turnTime);
    return this.freeCamera() ? this.freeView : poseView(this.poseId(), this.domain);
  }

  /** Every tick: aim the camera, select leaves for it (unless frozen) and upload them camera-relative. */
  private update(): void {
    const selector = this.selector;
    const surface = this.surface;
    if (!selector || !surface) return;
    const view = this.currentView();
    const camera = resolveCamera(view, this.domain, this.source);
    this.camera = camera;
    const engineCamera = this.engine.camera;
    const [right, up, back] = this.axes;
    right.set(...camera.right);
    up.set(...camera.up);
    back.set(-camera.forward[0], -camera.forward[1], -camera.forward[2]);
    engineCamera.position.set(0, 0, 0);
    engineCamera.quaternion.setFromRotationMatrix(this.basis.makeBasis(right, up, back));
    let aspect = 16 / 9;
    if (engineCamera instanceof PerspectiveCamera) {
      const near = Math.min(1000, Math.max(0.02, camera.clearanceM * 0.25));
      if (engineCamera.near !== near || engineCamera.far !== 1e9) {
        engineCamera.near = near;
        engineCamera.far = 1e9;
        engineCamera.updateProjectionMatrix();
      }
      aspect = engineCamera.aspect;
    }
    engineCamera.updateMatrixWorld();
    const { up: groundUp, east, north } = groundFrame(this.domain.kind, view.ground);
    // A low light across the cut (from the camera's right) throws one wall into shade and lights the other.
    const canyonLight = this.poseId() === 'biome-canyon' && this.zoomProgress === undefined;
    const sun = [0, 1, 2].map((k) => canyonLight ? 0.35 * groundUp[k] + (Math.cos(view.headingRad) * east[k] - Math.sin(view.headingRad) * north[k]) + 0.25 * (Math.cos(view.headingRad) * north[k] + Math.sin(view.headingRad) * east[k]) : groundUp[k] + 0.6 * east[k] + 0.4 * north[k]) as [number, number, number];
    surface.setSun(sun);
    this.sunLight?.position.set(sun[0], sun[1], sun[2]);

    const began = performance.now();
    let levelChanges = 0;
    let levelChangesAll = 0;
    if (!this.frozen()) {
      const height = (this.engine.renderer as unknown as RendererLike).domElement?.height || 1080;
      const fov = (FOV_DEG * Math.PI) / 180;
      const selectorView = this.selectorView;
      selectorView.camera = camera.position;
      selectorView.pixelAngle = (2 * Math.tan(fov / 2)) / height;
      frustumNormals(camera, fov, aspect, this.frustum);
      selector.select(selectorView);
      // Zero for a repeated view (select returned early); a frozen selection never calls it, so it counts none either.
      levelChanges = selector.stats.visibleNewSplits + selector.stats.visibleMerges;
      levelChangesAll = selector.stats.newSplits + selector.stats.merges;
    }
    const selectedAt = performance.now();
    surface.setDetailFade(Math.max(this.cellPixels(), PIXEL_FLOOR) * this.selectorView.pixelAngle);
    surface.upload(selector, camera.position);
    const uploadedAt = performance.now();
    this.selectOnlySamples.push(selectedAt - began);
    this.uploadOnlySamples.push(uploadedAt - selectedAt);
    const elapsed = performance.now() - began;
    this.selectionSamples.push(elapsed);
    this.leafSamples.push(selector.stats.leaves);
    this.levelChangeSamples.push(levelChanges);
    this.levelChangeAllSamples.push(levelChangesAll);
    this.hudSamples.push(elapsed);
    if (this.hudSamples.length > HUD_SAMPLES) this.hudSamples.shift();
    if (this.renderedFrames % 15 === 0) {
      this.stats.set({ ...selector.stats });
      this.selectionMs.set(this.hudSamples.reduce((a, b) => a + b, 0) / this.hudSamples.length);
      const altitude = view.altitudeM;
      this.altitudeLabel.set(altitude >= 10_000 ? `${Math.round(altitude / 1000).toLocaleString('en-US')} km` : `${altitude.toFixed(1)} m`);
    }
  }

  /**
   * Draws the backstop (inside the surface, no depth, so always under it) and then the surface into an offscreen RGBA8
   * target the size of the drawing buffer, reads it back and counts backstop pixels left inside the surface.
   */
  private async crackProbe(): Promise<ReturnType<typeof countCracks> & { width: number; height: number }> {
    if (!this.surface || !this.camera) throw new Error('No surface (WebGPU unavailable)');
    const renderer = this.engine.renderer as unknown as RendererLike & {
      getRenderTarget(): RenderTarget | null;
      setRenderTarget(target: RenderTarget | null): void;
      render(scene: Scene, camera: PerspectiveCamera): void;
      readRenderTargetPixelsAsync(target: RenderTarget, x: number, y: number, width: number, height: number): Promise<ArrayBufferView>;
    };
    const width = renderer.domElement?.width || 1280;
    const height = renderer.domElement?.height || 720;
    if (!this.probeParts) {
      const backstopMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
      backstopMaterial.colorNode = vec4(BACKSTOP_VALUE / 255, BACKSTOP_VALUE / 255, BACKSTOP_VALUE / 255, 1);
      backstopMaterial.toneMapped = false;
      const backstop = new Mesh(new SphereGeometry(1, 128, 64), backstopMaterial);
      backstop.renderOrder = -1;
      backstop.frustumCulled = false;
      const surface = new Mesh(this.surface.mesh.geometry, this.surface.probeMaterial);
      surface.frustumCulled = false;
      const scene = new Scene();
      scene.add(backstop, surface);
      this.probeParts = { target: new RenderTarget(width, height, { depthBuffer: true }), scene, surface, backstop, backstopMaterial };
    }
    const parts = this.probeParts;
    if (parts.target.width !== width || parts.target.height !== height) parts.target.setSize(width, height);
    parts.surface.geometry = this.surface.mesh.geometry;
    parts.surface.material = this.surface.probeMaterial;
    this.placeBackstop(parts.backstop, this.camera.position);
    const camera = this.engine.camera as PerspectiveCamera;
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(parts.target);
      renderer.render(parts.scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    const pixels = (await renderer.readRenderTargetPixelsAsync(parts.target, 0, 0, width, height)) as Uint8Array;
    return { ...countCracks(pixels, width, height), width, height };
  }

  /** The backstop lies wholly inside the surface: below its lowest height by a margin, a little smaller than the square. */
  private placeBackstop(backstop: Mesh, camera: readonly number[]): void {
    const size = this.domain.sizeM;
    const margin = Math.max(1, 0.002 * size);
    if (this.domain.kind === 'sphere') {
      if (!(backstop.geometry instanceof SphereGeometry)) {
        backstop.geometry.dispose();
        backstop.geometry = new SphereGeometry(1, 128, 64);
      }
      backstop.scale.setScalar(size - this.source.boundM - margin);
      backstop.position.set(-camera[0], -camera[1], -camera[2]);
    } else {
      if (!(backstop.geometry instanceof PlaneGeometry)) {
        backstop.geometry.dispose();
        backstop.geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      }
      backstop.scale.set(size - 2 * margin, 1, size - 2 * margin);
      backstop.position.set(-camera[0], -this.source.boundM - margin - camera[1], -camera[2]);
    }
    backstop.updateMatrixWorld();
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
      'surface.material': this.surfaceMaterial(),
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
      if (this.surface) this.surface.mesh.visible = false;
    }
    this.runnerReady.set(this.webGpuOk() && backend === 'webgpu' && this.renderedFrames > 3);
  }
}
