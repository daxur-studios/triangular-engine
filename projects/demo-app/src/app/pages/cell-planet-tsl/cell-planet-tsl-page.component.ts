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
} from 'three';
import type { Material } from 'three/webgpu';
import {
  EngineModule,
  EngineService,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import {
  cellLookupLayer,
  macroVariationLayer,
  planetBorderMaterial,
  planetMapBorderMaterial,
  planetOceanMaterial,
  PlanetSurfaceMaterial,
  setPlanetMapExtent,
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
} from 'triangular-engine/worldgen/render';
import { snapshotToOverlay } from '../../shared/overlay-snapshot';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import type { CellPlanetMorphWorkerRequest } from '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker';
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
 * Phase 3 adds the ocean shell, the map frame (fades in as the globe unrolls) and the cell-grid lines, all on the
 * same morph uniforms as the terrain.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const BACKEND: 'webgpu' | 'webgl2' =
  query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const ANTIALIAS = query.get('aa') === '1';
const TILES = query.get('tiles') !== '0';
const MACRO: 'off' | 'bodyFixed' | 'morphed' =
  query.get('macro') === 'off'
    ? 'off'
    : query.get('macro') === 'bodyFixed'
      ? 'bodyFixed'
      : 'morphed';

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
          (click)="
            projectionKind.set(
              projectionKind() === 'equalEarth'
                ? 'equirectangular'
                : 'equalEarth'
            )
          "
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
      </p>
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
  /** `?mesh=seam`: a synthetic globe that carries real `aOtherDir1/2`, so the vertex-side seam cull can be exercised. */
  readonly seamTest = query.get('mesh') === 'seam';

  readonly backend = BACKEND;
  readonly tiles = TILES;
  readonly macro = MACRO !== 'off';
  readonly macroOn = signal(true);
  readonly batchingOn = signal(true);
  readonly viewOn = signal(true);
  readonly drawCalls = signal(0);
  readonly tileDebug = signal(false);
  readonly cellsOn = signal(false);
  readonly oceanOn = signal(true);
  readonly gridOn = signal(false);
  readonly borderStyle = signal<'simple' | 'cartographic' | 'tactical'>(
    'cartographic',
  );
  readonly tileStats = signal({ resident: 0, queued: 0, maxLevel: 0 });
  readonly aa = ANTIALIAS;
  readonly radius = WORLD_SIZE_TIER_RADIUS_M.medium;
  readonly morphProgress = signal(0);
  readonly projectionKind = signal<MapProjectionKind>('equalEarth');
  /** Project in the shader from the tracked basis instead of mixing the baked flat positions. */
  readonly dynamic = signal(false);
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
  private readonly drawingBuffer = new Vector2();
  private readonly ocean = planetOceanMaterial({ morph: this.surface.morph });
  private oceanMesh?: Mesh;
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
    this.cellLookup.opacity.value = 0.72;
    this.addOceanAndFrame();
    this.engine.beforeRender$.subscribe(() => {
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
      this.surface.morph.uProjMode.value = this.dynamic() ? 1 : 0;
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
        projectionKind: 'equalEarth',
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
    // Same convention as the GLSL demo: the streamed terrain's sea datum is zero, and the helper's
    // tangent-frame sphere is translated to the origin.
    for (const name of ['position', 'aSpherePos']) {
      const attribute = ocean.getAttribute(name);
      if (!attribute || attribute.itemSize !== 3) continue;
      for (let index = 2; index < attribute.array.length; index += 3)
        attribute.array[index] += radius;
      attribute.needsUpdate = true;
    }
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
    this.mapBorderMesh = new Mesh(frame.geometry, this.mapBorder.material);
    this.mapBorderMesh.name = 'tsl-map-border';
    this.mapBorderMesh.renderOrder = 5;
    this.mapBorderMesh.frustumCulled = false;
    this.engine.scene.add(this.mapBorderMesh);
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
        if (
          (name === 'position' || name === 'aSpherePos') &&
          attribute.itemSize === 3
        ) {
          for (let index = 2; index < attribute.array.length; index += 3)
            attribute.array[index] += this.radius;
        }
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
    this.batchingOn.set((event.target as HTMLInputElement).checked);
    this.viewOn.set(false);
    setTimeout(() => this.viewOn.set(true));
  }

  setMacro(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.macroOn.set(on);
    this.macroLayer.enabled.value = on ? 1 : 0;
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
    if (on && this.cellLookup.enabled.value < 0.5) {
      this.cellLookup.setLookup(
        await this.streaming.requestCellLookup('material'),
      );
    }
    this.cellLookup.enabled.value = on ? 1 : 0;
  }

  setMorph(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value))
      this.morphProgress.set(Math.max(0, Math.min(1, value)));
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
