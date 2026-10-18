import {
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  Mesh,
  Vector2,
  Vector3,
} from 'three';
import { float, If, mix, uniform } from 'three/tsl';
import type { Material } from 'three/webgpu';
import {
  EngineModule,
  EngineService,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import {
  AtmosphereBackdrop,
  AtmosphereGpuModel,
  AtmosphereSkyViewLut,
  PlanetAtmosphereBinding,
  createAtmospherePreset,
  type PhysicalAtmosphereProfile,
} from 'triangular-engine/atmosphere';
import {
  cellLookupLayer,
  checkerDebugLayer,
  macroVariationLayer,
  planetBorderMaterial,
  planetMapBorderMaterial,
  planetOceanMaterial,
  PlanetSurfaceMaterial,
  setPlanetMapExtent,
  setPlanetProjectionCentre,
  streamedMaterialLayer,
  SURFACE_LAYER_ORDER,
} from 'triangular-engine/planet-material';
import type {
  ILatLonTerrainPatchAddress,
  ITerrainPatchMesh,
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
} from 'triangular-engine/terrain';
import {
  buildOceanMorphGeometry,
  buildPlanetMorphBorderGeometry,
  CellPlanetMorphStreamingViewComponent,
  WORLD_SIZE_TIER_RADIUS_M,
  type MapProjectionKind,
  CellPlanetMorphCameraRig,
} from 'triangular-engine/worldgen/render';
import { snapshotToOverlay } from '../../shared/overlay-snapshot';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import type { CellPlanetMorphWorkerRequest } from '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker';
import { runFrameBenchmark, type IBenchmarkScenario } from './frame-benchmark';
import {
  cancelBenchmarkSuite,
  completeSuiteEntry,
  currentSuiteEntry,
  startBenchmarkSuite,
  suiteResult,
  suiteSupported,
} from './benchmark-suite';
import { MaterialStreaming } from './material-streaming';

/**
 * Plan 050: the cell-planet streaming surface on `WebGPURenderer`, drawn by the TSL
 * `PlanetSurfaceMaterial` instead of the GLSL `onBeforeCompile` patches.
 *
 * `?backend=webgpu` (default) uses the native WebGPU backend, `?backend=webgl2` the same renderer on its
 * WebGL2 fallback. A renderer cannot be swapped live, so the toggle reloads. Antialiasing is off by
 * default (`?aa=1` turns MSAA on): Plan 050 Runbook, Phase 0 measured MSAA as the main frame-cost gap.
 *
 * Surface layers (Phase 2): vertex colour, then streamed material tiles, the per-cell colour lookup (the
 * territory overlay) and macro variation, in the GLSL patches' order. `?tiles=0` / `?macro=off|bodyFixed|morphed`
 * choose the stack at load (adding or removing a layer recompiles, so the stack is fixed at setup).
 * `?checker=1` adds the reusable debug checker layer (`checkerDebugLayer`) on top, toggled live from the panel.
 * Phase 3 adds the ocean shell, the map frame (fades in as the globe unrolls) and the cell-grid lines, all on the
 * same morph uniforms as the terrain.
 */
const pageStartMs = performance.now();
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' =
  query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const ANTIALIAS = query.get('aa') === '1';
/** `?gpuTiming=1` turns WebGPU timestamp queries on: an engine option, so the comparison needs two loads. */
const GPU_TIMING = query.get('gpuTiming') === '1';
/** Length of the measured window of `measureFrameWindow` (Plan 052 Phase 1). */
const FRAME_WINDOW_MS = 10_000;
/** How long to wait for streaming to go idle before the window starts; a timeout invalidates it. */
const FRAME_WINDOW_SETTLE_MS = 8_000;
/** Stored runs older than this are not compared, so a stale build or setting cannot produce a delta. */
const FRAME_WINDOW_MAX_STORED_AGE_MS = 24 * 60 * 60 * 1000;
const FRAME_WINDOW_KEY = 'cellPlanetTsl.frameWindow';
/** The map projection is baked into the streamed tiles, the ocean, the frame and the grid, so it is chosen at load. */
const PROJECTION: MapProjectionKind =
  query.get('projection') === 'equirectangular' ? 'equirectangular' : 'equalEarth';
const TILES = query.get('tiles') !== '0';
/** `?atmosphere=0` leaves the material on its stock lighting (the atmosphere is built once, at setup). */
const ATMOSPHERE = query.get('atmosphere') !== '0';
const MACRO: 'off' | 'bodyFixed' | 'morphed' =
  query.get('macro') === 'off'
    ? 'off'
    : query.get('macro') === 'bodyFixed'
      ? 'bodyFixed'
      : 'morphed';
/** `?checker=1` adds the debug checker layer to the stack at setup (adding a layer recompiles, so it is chosen at load). */
const CHECKER = query.get('checker') === '1';

/** The projection frame of the static (baked) map, which is centred on +Z. */
const STATIC_BASIS = { forward: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), right: new Vector3(1, 0, 0) };

@Component({
  standalone: true,
  selector: 'app-cell-planet-tsl-page',
  imports: [
    EngineModule,
    RouterLink,
    RaycastOrbitControlsComponent,
    CellPlanetMorphStreamingViewComponent,
  ],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    gpuTiming: GPU_TIMING,
    webGpuRendererParameters: {
      logarithmicDepthBuffer: true,
      forceWebGL: BACKEND === 'webgl2',
      antialias: ANTIALIAS,
    },
  }),
  host: { class: 'flex-page' },
  template: `
    <scene>
      <raycastOrbitControls
        [cameraPosition]="cameraPosition()"
        [target]="cameraTarget()"
        [near]="0.5"
        [far]="10000000"
        [raycastFocusResolver]="planetView()?.raycastFocusResolver"
      />
      <ambientLight [intensity]="1.2" />
      <directionalLight
        [position]="[2500, 3500, 3000]"
        [intensity]="2.2"
        [castShadow]="false"
      />

      @if (!seamTest && viewOn()) {
        <cellPlanetMorphStreamingView
          [radiusM]="radius"
          [meshGenerator]="meshGenerator"
          [morphProgress]="morphProgress()"
          [projectionKind]="projectionKind()"
          [maxLod]="6"
          [resolution]="32"
          [createMaterial]="createMaterial"
          (lodChange)="stats.set($event)"
          [batching]="batchingOn()"
          [maxPatches]="256"
          [maxInstallsPerFrame]="8"
          [lodPositionToleranceM]="1"
          [lodViewToleranceRadians]="0.005"
        />
      }
    </scene>

    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Cell Planet · TSL material</h2>
      <p class="row">
        <button
          (click)="switchBackend('webgpu')"
          [disabled]="backend === 'webgpu'"
        >
          WebGPU
        </button>
        <button
          (click)="switchBackend('webgl2')"
          [disabled]="backend === 'webgl2'"
        >
          forceWebGL
        </button>
      </p>
      <label
        >morph {{ morphProgress().toFixed(2) }}
        <input
          type="range"
          min="0"
          max="1"
          step="0.005"
          [value]="morphProgress()"
          (input)="setMorph($event)"
        />
      </label>
      <p class="row">
        <button (click)="scrubbing.set(!scrubbing())">
          {{ scrubbing() ? 'stop scrub' : 'scrub morph' }}
        </button>
        <button
          (click)="toggleProjection()"
          title="Reloads: the projection is baked into the tiles, ocean, frame and grid"
        >
          {{
            projectionKind() === 'equalEarth'
              ? 'Equal Earth'
              : 'Equirectangular'
          }}
        </button>
        <button (click)="dynamic.set(!dynamic())">
          projection in shader: {{ dynamic() ? 'on' : 'off' }}
        </button>
        <button (click)="toggleSeamGlobe()">
          synthetic seam globe: {{ seamTest ? 'on' : 'off' }}
        </button>
      </p>
      @if (dynamic()) {
        <label
          >centre lon {{ centerLon() }}°
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            [value]="centerLon()"
            (input)="centerLon.set(+$any($event.target).value)"
          />
        </label>
        <label
          >centre lat {{ centerLat() }}°
          <input
            type="range"
            min="-85"
            max="85"
            step="1"
            [value]="centerLat()"
            (input)="centerLat.set(+$any($event.target).value)"
          />
        </label>
      }
      <p class="row">
        <button (click)="measureFrameWindow()" [disabled]="benchmarkStatus() !== ''">
          measure frame window ({{ gpuTimingLabel }}, 10 s)
        </button>
      </p>
      <p class="row">
        <button (click)="runBenchmark()" [disabled]="benchmarkStatus() !== ''">
          run benchmark + copy
        </button>
      </p>
      <p class="row">
        <button (click)="runSuite()" [disabled]="benchmarkStatus() !== ''">
          run ALL (3 pages x 3 rounds, ~7 min)
        </button>
        @if (suiteLabel() !== '') {
          <button (click)="stopSuite()">cancel</button>
        }
      </p>
      @if (suiteResultText() !== '') {
        <p class="row"><button (click)="copySuiteResult()">copy suite result</button></p>
      }
      @if (lastReport() !== '' && benchmarkStatus() === '') {
        <p class="row"><button (click)="copyLastReport()">copy last report</button></p>
      }
      @if (benchmarkStatus() !== '') {
        <p>{{ benchmarkStatus() }}</p>
      }
      <p class="row">
        <button (click)="viewFront()">front</button>
        <button (click)="viewSeam()">antimeridian</button>
        <button (click)="viewMapEdge()">map edge</button>
      </p>
      <p class="row">
        <label
          ><input
            type="checkbox"
            [checked]="batchingOn()"
            (change)="setBatching($event)"
          />
          batching</label
        >
        <span>draw calls: {{ drawCalls() }}</span>
      </p>
      <p class="row">
        @if (macro) {
          <label
            ><input
              type="checkbox"
              [checked]="macroOn()"
              (change)="setMacro($event)"
            />
            macro</label
          >
        }
        @if (checker) {
          <label
            ><input
              type="checkbox"
              [checked]="checkerOn()"
              (change)="setChecker($event)"
            />
            checker</label
          >
        }
        @if (tiles) {
          <label
            ><input
              type="checkbox"
              [checked]="tileDebug()"
              (change)="setTileDebug($event)"
            />
            tile debug</label
          >
        }
        <label
          ><input
            type="checkbox"
            [checked]="cellsOn()"
            (change)="setCells($event)"
          />
          cell overlay</label
        >
        <label
          ><input
            type="checkbox"
            [checked]="keepGroundOn()"
            (change)="keepGroundOn.set($any($event.target).checked)"
          />
          keep ground in morph</label
        >
        <label
          ><input
            type="checkbox"
            [checked]="oceanOn()"
            (change)="setOcean($event)"
          />
          ocean</label
        >
        <label
          ><input
            type="checkbox"
            [checked]="gridOn()"
            (change)="setGrid($event)"
          />
          cell grid</label
        >
      </p>
      <p class="row">
        <button (click)="cycleBorderStyle()">frame: {{ borderStyle() }}</button>
      </p>
      @if (atmosphere) {
        <details open>
        <summary>Atmosphere</summary>
        <p class="row">
          <label
            ><input
              type="checkbox"
              [checked]="atmosphereOn()"
              (change)="setAtmosphere($event)"
            />
            atmosphere</label
          >
        </p>
        <label
          >sun longitude {{ sunLongitude() }}°
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            [value]="sunLongitude()"
            (input)="sunLongitude.set(+$any($event.target).value)"
          />
        </label>
        <label
          >sun latitude {{ sunLatitude() }}°
          <input
            type="range"
            min="-80"
            max="80"
            step="1"
            [value]="sunLatitude()"
            (input)="sunLatitude.set(+$any($event.target).value)"
          />
        </label>
        <label
          >exposure {{ exposure() }}
          <input
            type="range"
            min="1"
            max="30"
            step="0.5"
            [value]="exposure()"
            (input)="exposure.set(+$any($event.target).value)"
          />
        </label>
        <label
          >air height {{ heightLabel() }} (rebakes on release)
          <input
            type="range"
            min="0"
            max="1"
            step="0.005"
            [value]="heightSlider()"
            (input)="heightSlider.set(+$any($event.target).value)"
            (change)="applyHeight()"
          />
        </label>
        <p class="row">
          <button (click)="resetHeight()">preset height</button>
        </p>
        </details>
      }
      <p>
        Tiles {{ tileStats().resident }} (queued {{ tileStats().queued }}, max
        L{{ tileStats().maxLevel }})
      </p>
      <p>
        Resident {{ stats().resident }} · tris {{ stats().triangles }} · AA
        {{ aa ? 'on' : 'off' }}
      </p>
    </aside>
  `,
  styles: `
    :host {
      position: relative;
    }
    .panel {
      position: absolute;
      top: 1rem;
      left: 1rem;
      background: rgba(10, 14, 20, 0.85);
      color: #eee;
      padding: 1rem;
      border-radius: 8px;
      max-width: 340px;
      font: 13px/1.4 system-ui;
      z-index: 20;
    }
    .panel input[type='range'] {
      width: 100%;
    }
    .row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
  `,
})
export class CellPlanetTslPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly engine = inject(EngineService);
  readonly planetView = viewChild(CellPlanetMorphStreamingViewComponent);
  private readonly orbit = viewChild(RaycastOrbitControlsComponent);
  /** Keeps the camera over the same ground, at the same angle and up, while the planet morphs. */
  readonly keepGroundOn = signal(true);
  /** `?mesh=seam`: a synthetic globe that carries real `aOtherDir1/2`, so the vertex-side seam cull can be exercised. */
  readonly seamTest = query.get('mesh') === 'seam';

  readonly backend = BACKEND;
  readonly tiles = TILES;
  readonly macro = MACRO !== 'off';
  readonly macroOn = signal(true);
  readonly checker = CHECKER;
  readonly checkerOn = signal(true);
  readonly batchingOn = signal(true);
  /** Empty while idle; the running scenario (or the copy result) otherwise. */
  readonly benchmarkStatus = signal('');
  readonly lastReport = signal('');
  readonly suiteLabel = signal('');
  readonly suiteResultText = signal(suiteResult());
  /** Page construction to the first frame drawn after the renderer was ready (shader compile included). */
  private firstFrameMs = 0;
  readonly viewOn = signal(true);
  readonly drawCalls = signal(0);
  readonly tileDebug = signal(false);
  readonly cellsOn = signal(false);
  readonly oceanOn = signal(true);
  readonly gridOn = signal(false);
  readonly borderStyle = signal<'simple' | 'cartographic' | 'tactical'>(
    'cartographic',
  );
  readonly atmosphere = ATMOSPHERE;
  readonly atmosphereOn = signal(true);
  readonly sunLongitude = signal(40);
  readonly sunLatitude = signal(15);
  readonly exposure = signal(8);
  /** Air height as a fraction of the radius; `undefined` keeps the preset's (the terrain here is exaggerated, so it can be raised). */
  readonly thickness = signal<number | undefined>(undefined);
  readonly heightSlider = signal(0.5);
  readonly tileStats = signal({ resident: 0, queued: 0, maxLevel: 0 });
  readonly aa = ANTIALIAS;
  readonly radius = WORLD_SIZE_TIER_RADIUS_M.medium;
  private readonly morphCamera = new CellPlanetMorphCameraRig({
    radiusM: this.radius,
    projection: () => this.projectionKind(),
    basis: () =>
      this.surface.morph.uProjMode.value > 0.5
        ? {
            forward: this.surface.morph.uProjForward.value,
            up: this.surface.morph.uProjUp.value,
            right: this.surface.morph.uProjRight.value,
          }
        : STATIC_BASIS,
  });
  readonly morphProgress = signal(0);
  readonly projectionKind = signal<MapProjectionKind>(PROJECTION);
  /** Project in the shader from the tracked basis instead of mixing the baked flat positions. */
  readonly dynamic = signal(false);
  /** The dynamic projection's centre, degrees: the basis is set by hand, not by the camera (as the spike's manual centre). */
  readonly centerLon = signal(0);
  readonly centerLat = signal(0);
  readonly scrubbing = signal(false);
  readonly cameraPosition = signal<[number, number, number]>([
    0,
    0,
    this.radius * 2.6,
  ]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });

  /** One material, shared by the batch: its uniforms are this page's controls. */
  private readonly surface = new PlanetSurfaceMaterial();
  private readonly streaming = new MaterialStreaming({
    radiusM: this.radius,
    heightScaleM: getTerrainHeightScaleM(this.radius, 4),
    seed: CELL_PLANET_U0_FIXTURE.seed,
    worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
  });
  private readonly streamed = streamedMaterialLayer(this.streaming.gpu);
  private readonly cellLookup = cellLookupLayer();
  private readonly macroLayer = macroVariationLayer({
    positionSpace: MACRO === 'bodyFixed' ? 'bodyFixed' : 'morphed',
  });
  /** `?checker=1`: a reusable debug checker over geography, on top of every other layer. */
  private readonly checkerLayer = checkerDebugLayer({ space: 'latLon' });
  private readonly drawingBuffer = new Vector2();
  /** 1 = atmosphere fully on; the page sets it to zero when the toggle is off or the globe has unrolled. */
  private readonly atmosphereMix = uniform(1);
  private atmosphereParts?: {
    model: AtmosphereGpuModel;
    skyView: AtmosphereSkyViewLut;
    backdrop: AtmosphereBackdrop;
    binding: PlanetAtmosphereBinding;
  };
  private readonly ocean = planetOceanMaterial({ morph: this.surface.morph });
  private oceanMesh?: Mesh;
  /** True once the cell-id atlas was requested, so a second toggle while it loads does not request it again. */
  private cellLookupLoaded = false;
  private readonly mapBorder = planetMapBorderMaterial(this.surface.morph, {
    color: '#38bdf8',
    opacity: 0.95,
    borderStyle: 'cartographic',
    fadeStart: 0.35,
    fadeEnd: 0.15,
  });
  private mapBorderMesh?: Mesh;
  private readonly gridBorder = planetBorderMaterial(this.surface.morph, {
    color: '#38bdf8',
    opacity: 0.82,
  });
  private gridMesh?: LineSegments;
  private gridRequested = false;
  readonly createMaterial = (): Material => this.surface;

  /**
   * A lat/lon globe as non-indexed triangles with the dual-space attribute contract, including
   * `aOtherDir1/2` (the triangle's other two vertex directions), baked with an equirectangular flat map.
   * With the identity basis no triangle crosses the antimeridian; rotate the basis and the seam cuts through triangles.
   */
  private buildSeamTestGlobe(): Mesh {
    const lonSeg = 96;
    const latSeg = 48;
    const R = this.radius;
    const dir = (i: number, j: number): [number, number, number] => {
      const lon = -Math.PI + (i / lonSeg) * 2 * Math.PI;
      const lat = Math.PI / 2 - (j / latSeg) * Math.PI;
      return [
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
        Math.cos(lat) * Math.cos(lon),
      ];
    };
    const flat = (i: number, j: number): [number, number, number] => [
      ((i / lonSeg) * 2 - 1) * Math.PI * R,
      (0.5 - j / latSeg) * Math.PI * R,
      0,
    ];
    const tris: [number, number][][] = [];
    for (let j = 0; j < latSeg; j++) {
      for (let i = 0; i < lonSeg; i++) {
        tris.push([
          [i, j],
          [i, j + 1],
          [i + 1, j],
        ]);
        tris.push([
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ]);
      }
    }
    const n = tris.length * 3;
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const flatPos = new Float32Array(n * 3);
    const flatNorm = new Float32Array(n * 3);
    const other1 = new Float32Array(n * 3);
    const other2 = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    tris.forEach((tri, t) => {
      for (let k = 0; k < 3; k++) {
        const o = (t * 3 + k) * 3;
        const [i, j] = tri[k];
        const d = dir(i, j);
        const f = flat(i, j);
        const a = dir(...tri[(k + 1) % 3]);
        const b = dir(...tri[(k + 2) % 3]);
        for (let c = 0; c < 3; c++) {
          position[o + c] = d[c] * R;
          normal[o + c] = d[c];
          flatPos[o + c] = f[c];
          other1[o + c] = a[c];
          other2[o + c] = b[c];
        }
        flatNorm[o + 2] = 1;
        // A checker so stretched triangles are obvious.
        const checker = (Math.floor(i / 6) + Math.floor(j / 6)) % 2 === 0;
        color[o] = checker ? 0.85 : 0.2;
        color[o + 1] = checker ? 0.8 : 0.35;
        color[o + 2] = checker ? 0.55 : 0.6;
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    geometry.setAttribute('aFlatPos', new BufferAttribute(flatPos, 3));
    geometry.setAttribute('aFlatNorm', new BufferAttribute(flatNorm, 3));
    geometry.setAttribute('aOtherDir1', new BufferAttribute(other1, 3));
    geometry.setAttribute('aOtherDir2', new BufferAttribute(other2, 3));
    const mesh = new Mesh(geometry, this.seamMaterial);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Shares this page's uniforms; reads the seam-cull attributes the streaming geometry does not carry. */
  private readonly seamMaterial = new PlanetSurfaceMaterial({
    morph: this.surface.morph,
    seamCullAttributes: true,
  });

  private readonly worker = new Worker(
    new URL(
      '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker',
      import.meta.url,
    ),
    { type: 'module' },
  );
  private nextRequestId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress>) => void;
      reject: (e: Error) => void;
    }
  >();

  constructor() {
    setPlanetMapExtent(this.surface.morph, this.radius);
    // Stock order: streamed tiles, cell lookup, macro variation (SURFACE_LAYER_ORDER).
    if (TILES) {
      this.surface.addSurfaceLayer({
        id: 'streamedMaterial',
        order: SURFACE_LAYER_ORDER.streamedMaterial,
        layer: this.streamed.layer,
      });
    }
    this.surface.addSurfaceLayer({
      id: 'cellLookup',
      order: SURFACE_LAYER_ORDER.cellLookup,
      layer: this.cellLookup.layer,
    });
    if (this.macro) {
      this.surface.addSurfaceLayer({
        id: 'macroVariation',
        order: SURFACE_LAYER_ORDER.macroVariation,
        layer: this.macroLayer.layer,
      });
    }
    if (CHECKER) {
      this.surface.addSurfaceLayer({
        id: 'checkerDebug',
        order: SURFACE_LAYER_ORDER.game,
        layer: this.checkerLayer.layer,
      });
    }
    this.cellLookup.opacity.value = 0.72;
    this.addOceanAndFrame();
    if (ATMOSPHERE) this.addAtmosphere();
    this.resumeSuite();
    // After the scrub's `tick$` write and before the orbit controls settle in `lateUpdate$`: the camera and the
    // material move to the same morph together, so the ground never slides under a frame's camera.
    this.engine.postTick$.subscribe(() => {
      const morph = this.morphProgress();
      this.surface.morph.uMorph.value = morph;
      const controls = this.orbit()?.orbitControls();
      if (controls && this.keepGroundOn()) this.morphCamera.update(controls, morph);
      else this.morphCamera.reset();
    });
    this.engine.beforeRender$.subscribe(() => {
      this.syncAtmosphere();
      if (!this.firstFrameMs && (this.engine.renderer as any)?.initialized) {
        this.firstFrameMs = performance.now() - pageStartMs;
      }
      // The previous frame's count; `render.calls` is the classic name, `drawCalls` the WebGPU one.
      const info = (this.engine.renderer as any).info?.render;
      const calls = Number(info?.drawCalls ?? info?.calls ?? 0);
      if (calls !== this.drawCalls()) this.drawCalls.set(calls);
      if (!TILES) return;
      const camera = this.engine.camera;
      if (!camera) return;
      this.engine.renderer.getDrawingBufferSize(this.drawingBuffer);
      this.streaming.update(
        {
          camera,
          viewport: this.drawingBuffer,
          morphProgress: this.morphProgress(),
          projectionKind: this.projectionKind(),
        },
        this.drawingBuffer,
      );
      const stats = this.streaming.runtime.stats;
      const current = this.tileStats();
      if (
        stats.resident !== current.resident ||
        stats.queued !== current.queued ||
        stats.maxLevel !== current.maxLevel
      ) {
        this.tileStats.set({
          resident: stats.resident,
          queued: stats.queued,
          maxLevel: stats.maxLevel,
        });
      }
    });
    if (this.seamTest) this.engine.scene.add(this.buildSeamTestGlobe());
    if (query.get('debug') === '1') {
      // Hook for automated checks in a hidden browser pane (see `overlay-snapshot.ts`).
      (globalThis as unknown as { __cellPlanetTsl: unknown }).__cellPlanetTsl =
        {
          page: this,
          engine: this.engine,
          snap: () => snapshotToOverlay(this.engine),
        };
    }

    effect(() => {
      this.surface.morph.uMorph.value = this.morphProgress();
    });
    effect(() => {
      this.surface.morph.uProjectionType.value =
        this.projectionKind() === 'equalEarth' ? 1 : 0;
    });
    effect(() => {
      setPlanetProjectionCentre(
        this.surface.morph,
        this.dynamic() ? { lonDeg: this.centerLon(), latDeg: this.centerLat() } : null,
      );
    });

    // Morph scrub: 0 -> 1 -> 0 over 8 s, for checking the seam at every morph value.
    this.engine.tick$.subscribe((delta) => {
      if (!this.scrubbing()) return;
      scrubTime += delta;
      const phase = (scrubTime % 8) / 8;
      this.morphProgress.set(phase < 0.5 ? phase * 2 : 2 - phase * 2);
    });
    let scrubTime = 0;

    this.worker.onmessage = ({
      data,
    }: MessageEvent<{
      id: number;
      patch?: ITerrainPatchMesh<ILatLonTerrainPatchAddress>;
      error?: string;
    }>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else if (data.patch) entry.resolve(data.patch);
    };
    this.destroyRef.onDestroy(() => {
      this.worker.terminate();
      const parts = this.atmosphereParts;
      if (parts) {
        this.engine.scene.remove(parts.backdrop.mesh);
        parts.backdrop.dispose();
        parts.binding.dispose();
        parts.skyView.dispose();
        parts.model.dispose();
      }
      this.streaming.dispose();
      this.cellLookup.dispose();
      this.surface.dispose();
      this.ocean.material.dispose();
      this.mapBorder.material.dispose();
      this.gridBorder.material.dispose();
      this.seamMaterial.dispose();
    });
  }

  readonly meshGenerator = (
    request: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ILatLonTerrainPatchAddress>> => {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const workerRequest: CellPlanetMorphWorkerRequest = {
        id,
        address: request.address,
        radius: this.radius,
        baseResolution: request.baseResolution ?? request.resolution,
        resolution: request.resolution,
        edgeRefinementMask: request.edgeRefinementMask,
        edgeRefinementLevel: request.edgeRefinementLevel,
        edgeRefinementLevels: request.edgeRefinementLevels,
        edgeRefinementSegments: request.edgeRefinementSegments,
        reduction: 0.35,
        targetError: 0.08,
        projectionKind: this.projectionKind(),
        colorMode: 'material',
        heightScale: getTerrainHeightScaleM(this.radius, 4),
        worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
        seed: CELL_PLANET_U0_FIXTURE.seed,
      };
      this.worker.postMessage(workerRequest);
    });
  };

  /** The ocean shell and the map frame, built once: the demo has a fixed radius, projection and sea datum. */
  private addOceanAndFrame(): void {
    const radius = this.radius;
    const ocean = buildOceanMorphGeometry(
      radius,
      getTerrainHeightScaleM(radius, 4),
      0,
      this.projectionKind(),
      128,
      64,
    ).geometry;
    // Same convention as the GLSL demo: the streamed terrain's sea datum is zero, and the helper is body-fixed.
    ocean.computeBoundingSphere();
    this.oceanMesh = new Mesh(ocean, this.ocean.material);
    this.oceanMesh.name = 'tsl-ocean';
    this.oceanMesh.renderOrder = 1;
    this.oceanMesh.frustumCulled = false;
    this.engine.scene.add(this.oceanMesh);

    const frame = buildPlanetMorphBorderGeometry({
      radius,
      borderWidth: radius * 0.035,
      projectionKind: this.projectionKind(),
      clearance: radius * 0.0015,
    });
    frame.geometry.computeBoundingSphere();
    this.mapBorderMesh = new Mesh(frame.geometry, this.mapBorder.material);
    this.mapBorderMesh.name = 'tsl-map-border';
    this.mapBorderMesh.renderOrder = 5;
    this.mapBorderMesh.frustumCulled = false;
    this.engine.scene.add(this.mapBorderMesh);
  }

  /**
   * Plan 049 Phase 2b on the cell planet: the stock lighting and haze are replaced by the atmosphere's, and the
   * sky and limb are drawn behind the globe. The stages model a sphere, so both fade out as the globe unrolls
   * (`atmosphereMix` follows `1 - morph`); mid-morph haze is Phase 3. The planet is the scene's origin, so the
   * scene stands in for its transform, and one world unit is a metre.
   */
  private addAtmosphere(): void {
    const model = new AtmosphereGpuModel(this.atmosphereProfile());
    const skyView = new AtmosphereSkyViewLut(model);
    const backdrop = new AtmosphereBackdrop(model, { skyView });
    backdrop.groundEnabled.value = 0;
    backdrop.sunDiscStrength.value = 1;
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: this.radius, aerialPerspective: true });
    const lighting = binding.lighting();
    const perspective = binding.perspective();
    const amount = this.atmosphereMix;
    const lightingStage = {
      id: 'atmosphere',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stage: (context: any, input: any) => {
        // Uniform branch: with the atmosphere off (or the globe unrolled) the shader skips the sky lookups entirely.
        const out = input.color.toVar();
        If(amount.greaterThan(0), () => {
          out.assign(mix(input.color, lighting(context, input), float(amount)));
        });
        return out;
      },
    };
    const hazeStage = {
      id: 'atmosphere',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stage: (context: any, color: any) => {
        const out = color.toVar();
        If(amount.greaterThan(0), () => {
          out.assign(mix(color, perspective(context, color), float(amount)));
        });
        return out;
      },
    };
    this.surface.setLightingStage(lightingStage);
    this.surface.setAtmosphereStage(hazeStage);
    // The sea is a surface material too: same sky light and haze, so it does not read flatter than the terrain beside it.
    this.ocean.material.setLightingStage(lightingStage);
    this.ocean.material.setAtmosphereStage(hazeStage);
    this.engine.scene.add(backdrop.mesh);
    this.atmosphereParts = { model, skyView, backdrop, binding };
  }

  private atmosphereProfile(): PhysicalAtmosphereProfile {
    const profile = createAtmospherePreset('earth', { radiusM: this.radius, thickness: this.thickness() });
    if (profile.kind !== 'physical') throw new Error('Expected a physical atmosphere profile');
    return profile;
  }

  private sliderToThickness(v: number): number {
    return 0.002 * Math.pow(500, v);
  }

  heightLabel(): string {
    const t = this.thickness() ?? this.sliderToThickness(this.heightSlider());
    const m = t * this.radius;
    const length = m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(m < 1e5 ? 1 : 0)} km`;
    return `${this.thickness() === undefined ? 'preset ' : ''}${(t * 100).toFixed(t < 0.1 ? 2 : 0)}% of radius = ${length}`;
  }

  applyHeight(): void {
    this.thickness.set(this.sliderToThickness(this.heightSlider()));
    this.rebakeAtmosphere();
  }

  resetHeight(): void {
    this.thickness.set(undefined);
    this.rebakeAtmosphere();
  }

  private rebakeAtmosphere(): void {
    const parts = this.atmosphereParts;
    if (!parts) return;
    parts.model.setProfile(this.atmosphereProfile());
    parts.binding.refreshScale();
  }

  /** Runs after the orbit controls have settled, so the haze and the sky see the camera the frame is drawn with. */
  private syncAtmosphere(): void {
    const parts = this.atmosphereParts;
    const renderer: any = this.engine.renderer;
    const camera = this.engine.camera;
    if (!parts || !renderer?.initialized || !camera) return;
    const morph = this.morphProgress();
    // The surfaces keep their atmosphere through the morph (the haze blends to a flat slab by `binding.morph`); only the
    // sky behind the planet is a sphere's and fades out.
    const amount = this.atmosphereOn() ? 1 : 0;
    this.atmosphereMix.value = amount;
    parts.binding.morph.value = morph;
    const lon = (this.sunLongitude() * Math.PI) / 180;
    const lat = (this.sunLatitude() * Math.PI) / 180;
    parts.binding.setSunBody(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
    parts.binding.exposure.value = this.exposure();
    parts.binding.sync(camera, this.engine.scene, parts.backdrop);
    // The sky is a sphere's. Close to the ground it stays (the hazed horizon needs a sky behind it, whatever the morph);
    // it dissolves as the planet unrolls only once the camera is well above the air, from one to four air heights.
    const aboveAir = (parts.binding.skyAltitude.value as number) / (parts.model.uTopAltitude.value as number);
    const high = Math.min(1, Math.max(0, (aboveAir - 1) / 3));
    const unrolled = Math.min(1, Math.max(0, (morph - 0.2) / 0.6));
    const fade = unrolled * unrolled * (3 - 2 * unrolled) * high * high * (3 - 2 * high);
    parts.backdrop.opacity.value = 1 - fade;
    parts.backdrop.mesh.visible = amount > 0 && fade < 1;
    if (amount > 0) parts.binding.update(renderer);
    if (parts.backdrop.mesh.visible) parts.backdrop.update(renderer, camera);
  }

  setAtmosphere(event: Event): void {
    this.atmosphereOn.set((event.target as HTMLInputElement).checked);
  }

  setOcean(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.oceanOn.set(on);
    if (this.oceanMesh) this.oceanMesh.visible = on;
  }

  cycleBorderStyle(): void {
    const order = ['simple', 'cartographic', 'tactical'] as const;
    const next = order[(order.indexOf(this.borderStyle()) + 1) % order.length];
    this.borderStyle.set(next);
    this.mapBorder.style.value = order.indexOf(next);
  }

  /** The cell-grid lines: requested from a worker on first use, then shown or hidden. */
  async setGrid(event: Event): Promise<void> {
    const on = (event.target as HTMLInputElement).checked;
    this.gridOn.set(on);
    if (on && !this.gridMesh && !this.gridRequested) {
      this.gridRequested = true;
      const payload = await this.streaming.requestCellGrid(
        this.projectionKind(),
      );
      const geometry = new BufferGeometry();
      for (const [name, attribute] of Object.entries(payload.attributes)) {
        geometry.setAttribute(
          name,
          new BufferAttribute(attribute.array, attribute.itemSize),
        );
      }
      geometry.computeBoundingSphere();
      this.gridMesh = new LineSegments(
        geometry,
        this.gridBorder.material as never,
      );
      this.gridMesh.name = 'tsl-cell-grid';
      this.gridMesh.renderOrder = 4;
      this.gridMesh.frustumCulled = false;
      this.gridMesh.visible = this.gridOn();
      this.engine.scene.add(this.gridMesh);
    } else if (this.gridMesh) {
      this.gridMesh.visible = on;
    }
  }

  /** Recreates the streaming view, since the terrain surface reads `batching` when patches are installed. */
  setBatching(event: Event): void {
    this.applyBatching((event.target as HTMLInputElement).checked);
  }

  private applyBatching(on: boolean): void {
    if (this.batchingOn() === on) return;
    this.batchingOn.set(on);
    this.viewOn.set(false);
    setTimeout(() => this.viewOn.set(true));
  }

  runSuite(): void {
    if (!suiteSupported()) {
      this.benchmarkStatus.set('sessionStorage is blocked: the suite cannot run.');
      return;
    }
    startBenchmarkSuite(3);
  }

  stopSuite(): void {
    cancelBenchmarkSuite();
    this.suiteLabel.set('');
    location.reload();
  }

  async copySuiteResult(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.suiteResultText());
      this.benchmarkStatus.set('Suite result copied. Paste it back.');
    } catch {
      this.benchmarkStatus.set('Clipboard blocked: the suite result is in the console.');
    }
    setTimeout(() => this.benchmarkStatus.set(''), 4000);
  }

  /** Starts this page's share of a running suite once the first frame has rendered. */
  private resumeSuite(): void {
    const entry = currentSuiteEntry();
    if (!entry) return;
    this.suiteLabel.set(entry.label);
    this.benchmarkStatus.set(`suite ${entry.index}/${entry.total}: ${entry.label}, waiting for first frame`);
    const timer = setInterval(() => {
      if (!this.firstFrameMs) return;
      clearInterval(timer);
      setTimeout(() => void this.runBenchmark(), 2000);
    }, 500);
  }

  async copyLastReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.lastReport());
      this.benchmarkStatus.set('Copied to clipboard.');
    } catch {
      this.benchmarkStatus.set('Clipboard blocked: the report is in the console.');
    }
    setTimeout(() => this.benchmarkStatus.set(''), 4000);
  }

  readonly gpuTimingLabel = GPU_TIMING ? 'gpuTiming on' : 'gpuTiming off';

  /**
   * Plan 052 Phase 1: samples the current view for `FRAME_WINDOW_MS` with `FrameSampler`, as the
   * `gpuTiming` overhead test. The flag is an engine option set at load, so the comparison takes two
   * loads (`?gpuTiming=1`, then without it), each from the default view. Each run is kept in
   * localStorage per flag; once both exist, the report adds the difference.
   */
  async measureFrameWindow(): Promise<void> {
    if (this.benchmarkStatus() !== '') return;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const idle = () =>
      this.streaming.runtime.stats.queued === 0 && this.stats().queued === 0 && this.pending.size === 0;
    this.benchmarkStatus.set('measuring: waiting for streaming to settle');
    const settleStart = performance.now();
    while (performance.now() - settleStart < FRAME_WINDOW_SETTLE_MS && !idle()) {
      await sleep(250);
    }
    const settled = idle();
    const sampler = this.engine.fpsController.frameSampler;
    // Anything that makes the window untrustworthy is recorded on the window itself, so the verdict
    // reads `inconclusive` instead of the numbers looking valid.
    const onVisibility = () => {
      if (document.hidden) sampler.invalidate('hidden');
    };
    const onBlur = () => sampler.invalidate('unfocused');
    sampler.start();
    if (!settled) sampler.invalidate('streaming still busy after settle timeout');
    if (document.hidden) sampler.invalidate('hidden at start');
    if (!document.hasFocus()) sampler.invalidate('unfocused at start');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    this.benchmarkStatus.set(`measuring ${FRAME_WINDOW_MS / 1000} s, keep this tab visible and focused`);
    await sleep(FRAME_WINDOW_MS);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    const summary = sampler.stop();
    const flag = GPU_TIMING ? 'on' : 'off';
    const otherFlag = GPU_TIMING ? 'off' : 'on';
    const f = (v: number) => v.toFixed(2);
    const gpu = summary.gpuMedianMs === null ? 'n/a' : `${f(summary.gpuMedianMs)} ms (${summary.gpuSamples} samples)`;
    const invalid = summary.invalidReasons.length > 0 ? `, invalid: ${summary.invalidReasons.join('; ')}` : '';
    const line = `gpuTiming ${flag}: ${summary.frames} frames, cpu median ${f(summary.cpuMedianMs)} ms (p95 ${f(summary.cpuP95Ms)}), wall median ${f(summary.wallMedianMs)} ms (p95 ${f(summary.wallP95Ms)}), gpu ${gpu}, verdict ${summary.verdict}${invalid}`;

    // Runs are only compared within one profile (the settings that change the frame cost), so a
    // stored run from another backend or setting cannot produce a delta.
    const canvas = this.engine.renderer.domElement;
    const profile = `backend=${BACKEND};aa=${ANTIALIAS ? 1 : 0};projection=${PROJECTION};tiles=${TILES ? 1 : 0};macro=${MACRO};atmosphere=${ATMOSPHERE ? 1 : 0};canvas=${canvas.width}x${canvas.height};dpr=${devicePixelRatio}`;
    const key = (f: string) => `${FRAME_WINDOW_KEY}.${f}.${profile}`;
    const lines = ['### Frame window (gpuTiming overhead)', `- profile: ${profile}`, `- ${line}`];
    try {
      const record = {
        verdict: summary.verdict,
        cpuMedianMs: summary.cpuMedianMs,
        cpuSpreadMs: summary.cpuP95Ms - summary.cpuMedianMs,
        at: new Date().toISOString(),
      };
      localStorage.setItem(key(flag), JSON.stringify(record));
      const stored = JSON.parse(localStorage.getItem(key(otherFlag)) ?? 'null');
      const fresh = stored && Date.now() - Date.parse(stored.at) < FRAME_WINDOW_MAX_STORED_AGE_MS;
      if (!fresh) {
        lines.push(`- compare: no recent stored run for this profile. Load the page with ${GPU_TIMING ? 'no gpuTiming flag' : '?gpuTiming=1'} and measure again.`);
      } else if (stored.verdict !== 'ok' || summary.verdict !== 'ok') {
        lines.push(`- compare: not comparable (stored ${stored.verdict}, this run ${summary.verdict}). Measure again with a visible, focused tab.`);
      } else {
        const on = GPU_TIMING ? record : stored;
        const off = GPU_TIMING ? stored : record;
        const delta = on.cpuMedianMs - off.cpuMedianMs;
        const noise = Math.max(on.cpuSpreadMs, off.cpuSpreadMs);
        const pct = off.cpuMedianMs > 0 ? ((delta / off.cpuMedianMs) * 100).toFixed(0) : 'n/a';
        const reading = Math.abs(delta) <= noise ? 'within the run-to-run spread: no measurable difference' : 'outside the spread: a real difference at this noise level';
        lines.push(`- compare (stored ${stored.at}): cpu median on minus off ${delta >= 0 ? '+' : ''}${f(delta)} ms (${pct} %), ${reading}.`);
      }
    } catch {
      lines.push('- compare: localStorage blocked, copy the line above by hand.');
    }
    const report = lines.join('\n');
    console.info(report);
    this.lastReport.set(report);
    try {
      await navigator.clipboard.writeText(report);
      this.benchmarkStatus.set('Frame window copied to clipboard.');
    } catch {
      this.benchmarkStatus.set('Clipboard blocked: the report is in the console.');
    }
    setTimeout(() => this.benchmarkStatus.set(''), 1500);
  }

  /** Runs every scenario in turn, then copies a markdown table to the clipboard (and logs it). */
  async runBenchmark(): Promise<void> {
    if (this.benchmarkStatus() !== '' && this.suiteLabel() === '') return;
    const was = {
      morph: this.morphProgress(),
      dynamic: this.dynamic(),
      batching: this.batchingOn(),
      atmosphere: this.atmosphereOn(),
      scrubbing: this.scrubbing(),
    };
    const set = (
      morph: number,
      batching: boolean,
      options: { dynamic?: boolean; atmosphere?: boolean } = {},
    ): (() => void) => () => {
      this.scrubbing.set(false);
      this.morphProgress.set(morph);
      this.dynamic.set(options.dynamic ?? false);
      this.atmosphereOn.set(options.atmosphere ?? true);
      this.centerLon.set(0);
      this.centerLat.set(0);
      this.applyBatching(batching);
    };
    const scenarios: IBenchmarkScenario[] = [];
    for (const batching of [true, false]) {
      for (const morph of [0, 0.5, 1]) {
        scenarios.push({
          name: `morph ${morph}, batching ${batching ? 'on' : 'off'}`,
          apply: set(morph, batching),
        });
      }
    }
    scenarios.push(
      { name: 'morph 1, projection in shader, batching on', apply: set(1, true, { dynamic: true }) },
      { name: 'morph 0, atmosphere off, batching on', apply: set(0, true, { atmosphere: false }) },
    );
    this.viewFront();
    try {
      const { report } = await runFrameBenchmark({
        scenarios,
        frameSampler: this.engine.fpsController.frameSampler,
        // Nothing queued in the runtime or the surface, and no mesh request still out at the worker.
        isSettled: () =>
          this.streaming.runtime.stats.queued === 0 &&
          this.stats().queued === 0 &&
          this.pending.size === 0,
        describe: () => {
          const t = this.stats();
          return `tiles ${this.tileStats().resident}, tris ${t.triangles}, draws ${this.drawCalls()}`;
        },
        header: () => {
          const canvas = this.engine.renderer.domElement;
          return [
            `backend: ${BACKEND} (${(this.engine.renderer as any).backend?.isWebGPUBackend ? 'native WebGPU' : 'WebGL2 path'}), AA ${ANTIALIAS ? 'on' : 'off'}`,
            `materials: TSL PlanetSurfaceMaterial, tiles ${TILES ? 'on' : 'off'}, macro ${MACRO}, atmosphere ${ATMOSPHERE ? 'on' : 'off'}`,
            `canvas ${canvas.width}x${canvas.height}, devicePixelRatio ${devicePixelRatio}`,
            `page load to first frame: ${this.firstFrameMs.toFixed(0)} ms`,
            `frame times are rAF deltas, capped by the display refresh rate`,
            `UA: ${navigator.userAgent}`,
          ];
        },
        onProgress: (text) => this.benchmarkStatus.set(`benchmark ${text}`),
      });
      console.info(report);
      this.lastReport.set(report);
      if (this.suiteLabel() !== '') {
        if (completeSuiteEntry(report) === 'finished') {
          this.suiteLabel.set('');
          this.suiteResultText.set(suiteResult());
          this.benchmarkStatus.set('Suite finished. Press "copy suite result".');
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(report);
        this.benchmarkStatus.set('Copied to clipboard. Paste it back.');
      } catch {
        this.benchmarkStatus.set('Clipboard blocked: the report is in the console.');
      }
    } finally {
      this.morphProgress.set(was.morph);
      this.dynamic.set(was.dynamic);
      this.atmosphereOn.set(was.atmosphere);
      this.scrubbing.set(was.scrubbing);
      this.applyBatching(was.batching);
      setTimeout(() => this.benchmarkStatus.set(''), 6000);
    }
  }

  setMacro(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.macroOn.set(on);
    this.macroLayer.enabled.value = on ? 1 : 0;
  }

  setChecker(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.checkerOn.set(on);
    this.checkerLayer.enabled.value = on ? 1 : 0;
  }

  setTileDebug(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.tileDebug.set(on);
    this.streaming.gpu.debug.value = on ? 1 : 0;
  }

  /** The territory overlay: asks a worker for the cell-id atlas on first use, then toggles the layer. */
  async setCells(event: Event): Promise<void> {
    const on = (event.target as HTMLInputElement).checked;
    this.cellsOn.set(on);
    if (on && !this.cellLookupLoaded) {
      this.cellLookupLoaded = true;
      try {
        this.cellLookup.setLookup(
          await this.streaming.requestCellLookup('material'),
        );
      } catch (error) {
        this.cellLookupLoaded = false;
        throw error;
      }
    }
    // Read after the await: a toggle off (or on again) while the atlas was loading wins.
    this.cellLookup.enabled.value = this.cellsOn() ? 1 : 0;
  }

  setMorph(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value))
      this.morphProgress.set(Math.max(0, Math.min(1, value)));
  }

  /** Reloads with the other projection: tiles, ocean, frame and grid all bake it, so a live switch would mix the two. */
  toggleProjection(): void {
    const url = new URL(globalThis.location.href);
    url.searchParams.set(
      'projection',
      this.projectionKind() === 'equalEarth' ? 'equirectangular' : 'equalEarth',
    );
    globalThis.location.href = url.toString();
  }

  toggleSeamGlobe(): void {
    const url = new URL(globalThis.location.href);
    if (this.seamTest) url.searchParams.delete('mesh');
    else url.searchParams.set('mesh', 'seam');
    globalThis.location.href = url.toString();
  }

  viewFront(): void {
    this.cameraPosition.set([0, 0, this.radius * 2.6]);
    this.cameraTarget.set([0, 0, 0]);
  }

  /** The back of the globe, where the antimeridian (longitude +/-pi) sits; also centres the flat map's seam row. */
  viewSeam(): void {
    this.cameraPosition.set([0, 0, -this.radius * 2.6]);
    this.cameraTarget.set([0, 0, 0]);
  }

  /** The flat map's left/right edge, where the antimeridian cuts the map. */
  viewMapEdge(): void {
    const edge = Math.PI * this.radius;
    this.cameraPosition.set([edge, 0, this.radius * 2.2]);
    this.cameraTarget.set([edge, 0, 0]);
  }

  switchBackend(backend: 'webgpu' | 'webgl2'): void {
    const params = new URLSearchParams(location.search);
    params.set('backend', backend);
    location.assign(`${location.pathname}?${params}`);
  }
}
