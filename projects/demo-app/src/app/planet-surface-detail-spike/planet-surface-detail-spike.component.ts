import { JsonPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Mesh, Vector2, Vector3 } from 'three';
import type { Material } from 'three/webgpu';
import { EngineModule, EngineService, RaycastOrbitControlsComponent } from 'triangular-engine';
import { PlanetAtmosphereComponent } from 'triangular-engine/atmosphere';
import {
  macroVariationLayer,
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
  CellPlanetMorphStreamingViewComponent,
  WORLD_SIZE_TIER_RADIUS_M,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_U0_FIXTURE } from '../pages/cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../pages/cell-planet-25d-map/cell-planet-terrain-scale';
import type { CellPlanetMorphWorkerRequest } from '../pages/cell-planet-morph-streaming/cell-planet-morph-streaming.worker';
import { FOREST_CROWN_WIDTH_M, FOREST_SPACING_M, forestFadeBand } from './forest-field';
import { ForestInstances } from './forest-instances';
import { forestLayer, type ForestViewMode } from './forest-layer';
import { MaterialStreaming } from './material-streaming';
import { runwayLayer } from './runway-layer';
import { RUNWAY_LENGTH_M, RUNWAY_WIDTH_M, runwayFrame, type IRunwaySite } from './runway-site';

/** Scatter disc radius around the camera (metres), grid spacing, and the instance buffer size. */
const SCATTER_RADIUS_M = 3000;
const SCATTER_SPACING_M = FOREST_SPACING_M;
const SCATTER_CAPACITY = 140_000;
/** The camera may drift this far (metres) from the scatter centre before the next scatter is requested. */
const SCATTER_RECENTRE_M = 500;

const query = new URLSearchParams(globalThis.location?.search ?? '');
/**
 * `?runway=on` (default): height stamp and SDF paint. `paint`: SDF only, natural terrain under it. `stamp`: flattened
 * terrain only. `off`: neither. The stamp is baked into the terrain meshes, so it is chosen at load.
 */
type RunwayMode = 'on' | 'paint' | 'stamp' | 'off';
const RUNWAY: RunwayMode = (['paint', 'stamp', 'off'] as const).find((m) => m === query.get('runway')) ?? 'on';
const GPU_TIMING = query.get('gpuTiming') === '1';

interface IViewPreset {
  readonly label: string;
  readonly altitudeM: number;
}

/**
 * Plan 063 spike S1 (Q2): a ~2 km x 45 m runway on the cell planet, drawn only by the material (SDF layer) on terrain
 * that was flattened under it in the height source. Falsifies: "a flattened-height runway drawn by an SDF layer stays
 * on the ground at every terrain LOD". Cloned from `/cell-planet-tsl` (morph, projection and benchmarks removed).
 */
@Component({
  selector: 'app-planet-surface-detail-spike',
  imports: [EngineModule, JsonPipe, RouterLink, RaycastOrbitControlsComponent, PlanetAtmosphereComponent, CellPlanetMorphStreamingViewComponent],
  providers: EngineService.provide({
    showFPS: true,
    preferredRenderer: 'webgpu',
    gpuTiming: GPU_TIMING,
    webGpuRendererParameters: { logarithmicDepthBuffer: true, antialias: false },
  }),
  host: { class: 'flex-page' },
  templateUrl: './planet-surface-detail-spike.component.html',
  styleUrl: './planet-surface-detail-spike.component.scss',
})
export class PlanetSurfaceDetailSpikeComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly engine = inject(EngineService);
  readonly planetView = viewChild(CellPlanetMorphStreamingViewComponent);

  readonly runwayMode = RUNWAY;
  readonly radius = WORLD_SIZE_TIER_RADIUS_M.medium;
  private readonly heightScaleM = getTerrainHeightScaleM(this.radius, 4);
  readonly runwayLengthM = RUNWAY_LENGTH_M;
  readonly runwayWidthM = RUNWAY_WIDTH_M;

  readonly views: readonly IViewPreset[] = [
    { label: '60 m', altitudeM: 60 },
    { label: '300 m', altitudeM: 300 },
    { label: '1.5 km', altitudeM: 1500 },
    { label: '6 km', altitudeM: 6000 },
    { label: '25 km', altitudeM: 25_000 },
    { label: '100 km', altitudeM: 100_000 },
    { label: '400 km', altitudeM: 400_000 },
  ];
  readonly paintOn = signal(RUNWAY === 'on' || RUNWAY === 'paint');
  readonly top = signal(false);
  readonly altitudeM = signal(1500);
  readonly site = signal<IRunwaySite | null>(null);
  readonly siteText = computed(() => {
    const s = this.site();
    if (!s) return RUNWAY === 'off' ? 'runway off' : 'searching for a flat dry site...';
    const lat = (Math.asin(s.centre[1]) * 180) / Math.PI;
    const lon = (Math.atan2(s.centre[0], s.centre[2]) * 180) / Math.PI;
    return `site ${lat.toFixed(2)}° N, ${lon.toFixed(2)}° E, ground ${s.heightM.toFixed(0)} m`;
  });
  /** Where `jump` looks: the runway site, or a forest found by `focusForest`. */
  readonly focus = signal<IRunwaySite | null>(null);
  readonly forestText = signal('forest: not looked for yet');
  readonly viewMode = signal<ForestViewMode>(0);
  readonly fadeStartM = signal(Math.round(forestFadeBand().startM));
  readonly fadeWidthM = signal(Math.round(forestFadeBand().endM - forestFadeBand().startM));
  readonly densityScale = signal(1);
  readonly shadowSteps = signal(4);
  readonly treeCount = signal(0);
  readonly crownWidthM = FOREST_CROWN_WIDTH_M;
  readonly forestBand = forestFadeBand();
  readonly sunElevation = signal(50);
  readonly sunAzimuth = signal(0);
  readonly exposure = signal(8);
  readonly tileStats = signal({ resident: 0, queued: 0, maxLevel: 0 });
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });
  readonly cameraPosition = signal<[number, number, number]>([0, 0, this.radius * 2.6]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);

  private readonly surface = new PlanetSurfaceMaterial();
  private readonly streaming = new MaterialStreaming({
    radiusM: this.radius,
    heightScaleM: this.heightScaleM,
    seed: CELL_PLANET_U0_FIXTURE.seed,
    worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
  });
  private readonly streamed = streamedMaterialLayer(this.streaming.gpu);
  private readonly macroLayer = macroVariationLayer({ positionSpace: 'morphed' });
  private readonly runway = runwayLayer();
  private readonly forest = forestLayer(WORLD_SIZE_TIER_RADIUS_M.medium);
  private forestInstances?: ForestInstances;
  private scatterCentre: Vector3 | null = null;
  private scatterInFlight = false;
  private scatterWantedDensity = 1;
  readonly atmosphereRef = viewChild(PlanetAtmosphereComponent);
  private readonly ocean = planetOceanMaterial({ morph: this.surface.morph });
  readonly atmosphereSurfaces = [this.surface, this.ocean.material];
  readonly atmosphereMorph = this.surface.morph.uMorph;
  readonly createMaterial = (): Material => this.surface;
  private readonly drawingBuffer = new Vector2();

  readonly sunDirection = computed<[number, number, number]>(() => {
    const s = this.site();
    const el = (this.sunElevation() * Math.PI) / 180;
    const az = (this.sunAzimuth() * Math.PI) / 180;
    if (!s) return [0.5, 0.3, 0.8];
    // Elevation above the site horizon, azimuth from the runway heading.
    const horizontal = [0, 1, 2].map((i) => s.along[i] * Math.cos(az) + s.across[i] * Math.sin(az));
    const v = [0, 1, 2].map((i) => s.centre[i] * Math.sin(el) + horizontal[i] * Math.cos(el));
    return [v[0], v[1], v[2]];
  });

  private readonly worker = new Worker(new URL('./planet-surface-detail-spike.worker', import.meta.url), { type: 'module' });
  private nextRequestId = 0;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** Resolves once the runway site is known (or `null` when the mode has no stamp); mesh requests wait for it. */
  private readonly siteReady: Promise<void>;

  constructor() {
    setPlanetMapExtent(this.surface.morph, this.radius);
    this.surface.addSurfaceLayer({ id: 'streamedMaterial', order: SURFACE_LAYER_ORDER.streamedMaterial, layer: this.streamed.layer });
    this.surface.addSurfaceLayer({ id: 'macroVariation', order: SURFACE_LAYER_ORDER.macroVariation, layer: this.macroLayer.layer });
    this.surface.addSurfaceLayer({ id: 'runway', order: SURFACE_LAYER_ORDER.game, layer: this.runway.layer });
    this.surface.addSurfaceLayer({ id: 'forest', order: SURFACE_LAYER_ORDER.game - 100, layer: this.forest.layer });
    this.surface.addSunOcclusion({ id: 'forestShadow', occlusion: this.forest.occlusion });
    this.addOcean();

    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; patch?: unknown; runwaySite?: IRunwaySite | null; error?: string }>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data);
    };

    this.siteReady =
      RUNWAY === 'off'
        ? Promise.resolve()
        : this.request({
            kind: 'runwaySite',
            radiusM: this.radius,
            heightScaleM: this.heightScaleM,
            worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
            seed: CELL_PLANET_U0_FIXTURE.seed,
          }).then((data) => {
            const site = data.runwaySite as IRunwaySite | null;
            if (!site) return;
            this.runway.setSite(site.along, site.across);
            this.forest.setSite(site.along, site.across);
            this.site.set(site);
            this.jump(this.altitudeM());
          });

    effect(() => {
      this.runway.enabled.value = this.paintOn() && this.site() ? 1 : 0;
    });

    // Forest controls are live uniforms (nothing recompiles); the shadow step count is a uniform branch.
    effect(() => {
      const u = this.forest.uniforms;
      u.mode.value = this.viewMode();
      u.fadeStartM.value = this.fadeStartM();
      u.fadeEndM.value = this.fadeStartM() + this.fadeWidthM();
      u.densityScale.value = this.densityScale();
      u.shadowSteps.value = this.shadowSteps();
      const [x, y, z] = this.sunDirection();
      u.sunBody.value.set(x, y, z);
      if (this.forestInstances) this.forestInstances.mesh.visible = this.viewMode() !== 2;
    });

    // The near form needs the atmosphere's binding: build it once the atmosphere exists.
    effect(() => {
      const binding = this.atmosphereRef()?.atmosphere()?.binding;
      if (!binding || this.forestInstances) return;
      this.forestInstances = new ForestInstances(
        this.forest,
        binding,
        this.surface.morph.uBodyCentreScene as unknown,
        SCATTER_CAPACITY,
      );
      this.engine.scene.add(this.forestInstances.mesh);
    });

    this.engine.beforeRender$.subscribe(() => {
      const camera = this.engine.camera;
      if (!camera) return;
      this.engine.renderer.getDrawingBufferSize(this.drawingBuffer);
      this.streaming.update(
        { camera, viewport: this.drawingBuffer, morphProgress: 0, projectionKind: 'equalEarth' },
        this.drawingBuffer,
      );
      this.updateForestInstances(camera.position);
      const s = this.streaming.runtime.stats;
      const current = this.tileStats();
      if (s.resident !== current.resident || s.queued !== current.queued || s.maxLevel !== current.maxLevel) {
        this.tileStats.set({ resident: s.resident, queued: s.queued, maxLevel: s.maxLevel });
      }
    });

    // Hook for automated checks from the browser pane.
    (globalThis as unknown as { __psd: unknown }).__psd = {
      page: this,
      jump: (altitudeM: number, top = false, lateralM = 0) => {
        this.top.set(top);
        this.jump(altitudeM, lateralM);
      },
      /** Jumps, waits for streaming to settle, then audits the terrain under the runway. */
      step: async (altitudeM: number, top = false) => {
        this.top.set(top);
        this.jump(altitudeM);
        await new Promise((r) => setTimeout(r, 2500));
        for (let i = 0; i < 40; i += 1) {
          await new Promise((r) => setTimeout(r, 500));
          if (this.tileStats().queued === 0 && this.stats().queued === 0 && this.stats().resident > 0) break;
        }
        const a = this.auditTerrainUnderRunway();
        return { altitudeM, patches: a.patches, samples: a.samples, maxDevM: a.maxDevM, rows: a.rows.map((r) => `${r.maxEdgeM}m/${r.maxDevM}`).join(' ') };
      },
    };

    this.destroyRef.onDestroy(() => {
      this.forestInstances?.dispose();
      this.worker.terminate();
      this.streaming.dispose();
      this.surface.dispose();
      this.ocean.material.dispose();
    });
  }

  private request(message: Record<string, unknown>): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  readonly meshGenerator = async (
    request: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ILatLonTerrainPatchAddress>> => {
    await this.siteReady;
    const workerRequest: CellPlanetMorphWorkerRequest & { runwayStamp: boolean } = {
      id: 0,
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
      heightScale: this.heightScaleM,
      worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
      seed: CELL_PLANET_U0_FIXTURE.seed,
      runwayStamp: RUNWAY === 'on' || RUNWAY === 'stamp',
    };
    const data = await this.request(workerRequest as unknown as Record<string, unknown>);
    return data.patch as ITerrainPatchMesh<ILatLonTerrainPatchAddress>;
  };

  private addOcean(): void {
    const geometry = buildOceanMorphGeometry(this.radius, this.heightScaleM, 0, 'equalEarth', 128, 64).geometry;
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, this.ocean.material);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.engine.scene.add(mesh);
  }

  /**
   * Keeps the instance scatter around the camera: asks the worker for trees when the camera has drifted from the last
   * scatter centre (or the density scale changed) and the camera is low enough for individual trees to matter.
   */
  private updateForestInstances(cameraScene: Vector3): void {
    const instances = this.forestInstances;
    if (!instances) return;
    instances.update();
    if (this.scatterInFlight || this.viewMode() === 2) return;
    const body = cameraScene.clone().sub(this.surface.morph.uBodyCentreScene.value as Vector3);
    const altitudeM = body.length() - this.radius;
    if (altitudeM > this.fadeStartM() + this.fadeWidthM() + 1500) return;
    const ground = body.clone().normalize().multiplyScalar(this.radius);
    const stale =
      !this.scatterCentre ||
      this.scatterCentre.distanceTo(ground) > SCATTER_RECENTRE_M ||
      this.scatterWantedDensity !== this.densityScale();
    if (!stale) return;
    this.scatterInFlight = true;
    this.scatterCentre = ground;
    this.scatterWantedDensity = this.densityScale();
    const centre = ground.clone().normalize();
    void this.request({
      kind: 'forestScatter',
      radiusM: this.radius,
      heightScaleM: this.heightScaleM,
      worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
      seed: CELL_PLANET_U0_FIXTURE.seed,
      centre: [centre.x, centre.y, centre.z],
      areaRadiusM: SCATTER_RADIUS_M,
      spacingM: SCATTER_SPACING_M,
      densityScale: this.scatterWantedDensity,
      site: this.site(),
      stamp: RUNWAY === 'on' || RUNWAY === 'stamp',
    })
      .then((data) => {
        instances.setTrees(ground, data.trees as Float32Array);
        this.treeCount.set(instances.treeCount);
      })
      .finally(() => (this.scatterInFlight = false));
  }

  /** Finds solid forest near the runway site and points the camera presets at it. */
  focusForest(): void {
    const site = this.site();
    if (!site) return;
    this.forestText.set('searching for solid forest...');
    void this.request({
      kind: 'forestSpot',
      radiusM: this.radius,
      heightScaleM: this.heightScaleM,
      worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
      seed: CELL_PLANET_U0_FIXTURE.seed,
      site,
      densityScale: this.densityScale(),
      stamp: RUNWAY === 'on' || RUNWAY === 'stamp',
    }).then((data) => {
      const spot = data.forestSpot as { centre: [number, number, number]; heightM: number } | null;
      if (!spot) {
        this.forestText.set('no solid forest within 20 km of the runway');
        return;
      }
      const frame = runwayFrame(spot.centre, 0.4);
      this.focus.set({ centre: spot.centre, along: frame.along, across: frame.across, heightM: spot.heightM });
      const lat = (Math.asin(spot.centre[1]) * 180) / Math.PI;
      const lon = (Math.atan2(spot.centre[0], spot.centre[2]) * 180) / Math.PI;
      this.forestText.set(`forest ${lat.toFixed(3)}° N, ${lon.toFixed(3)}° E, ground ${spot.heightM.toFixed(0)} m`);
      this.jump(this.altitudeM());
    });
  }

  focusRunway(): void {
    this.focus.set(null);
    this.jump(this.altitudeM());
  }

  /** Puts the camera `altitudeM` above the focus (the runway centre, or a forest), looking at it (oblique, or straight down with `top`). */
  jump(altitudeM: number, lateralM = 0): void {
    this.altitudeM.set(altitudeM);
    const s = this.focus() ?? this.site();
    if (!s) return;
    const r = this.radius + s.heightM;
    const target = new Vector3(s.centre[0], s.centre[1], s.centre[2]).multiplyScalar(r);
    const up = new Vector3(...s.centre);
    const along = new Vector3(...s.along);
    const across = new Vector3(...s.across);
    const back = this.top() ? 0 : -altitudeM * 0.8;
    const position = target
      .clone()
      .addScaledVector(up, altitudeM)
      .addScaledVector(along, back + lateralM)
      .addScaledVector(across, this.top() ? altitudeM * 0.002 : 0);
    this.cameraTarget.set([target.x, target.y, target.z]);
    this.cameraPosition.set([position.x, position.y, position.z]);
  }

  /**
   * Q2 evidence: how far the resident terrain mesh sits from the flattened runway height. Samples the runway
   * footprint (every 100 m along, at the centreline and both edges), interpolates the mesh triangle under each
   * sample, and reports per patch the largest vertical deviation from the plateau and the triangle edge length there.
   */
  auditTerrainUnderRunway(): { patches: number; samples: number; maxDevM: number; rows: { verts: number; hits: number; maxDevM: number; maxEdgeM: number }[] } {
    const site = this.site();
    const empty = { patches: 0, samples: 0, maxDevM: 0, rows: [] };
    if (!site) return empty;
    let batched: any;
    this.engine.scene.traverse((o) => {
      if ((o as any).isBatchedMesh) batched = o;
    });
    if (!batched) return empty;
    const plateau = this.radius + site.heightM;
    const position = batched.geometry.attributes.position;
    const index = batched.geometry.index;
    const matrix = batched.matrix.clone();
    const [A, B] = [site.along, site.across];
    const samples: [number, number][] = [];
    for (let a = -1000; a <= 1000; a += 100) for (const b of [-22.5, 0, 22.5]) samples.push([a, b]);
    const rows: { verts: number; hits: number; maxDevM: number; maxEdgeM: number }[] = [];
    let total = 0;
    let worst = 0;
    for (let i = 0; i < batched._instanceInfo.length; i += 1) {
      const info = batched._instanceInfo[i];
      if (!info.active || !info.visible) continue;
      batched.getMatrixAt(i, matrix);
      // The batch re-centres its instances on the mesh position (a render origin): world = mesh position + instance translation + vertex.
      const [tx, ty, tz] = [matrix.elements[12] + batched.position.x, matrix.elements[13] + batched.position.y, matrix.elements[14] + batched.position.z];
      const geometry = batched._geometryInfo[info.geometryIndex];
      // BatchedMesh stores indices already offset by the geometry's vertex start.
      const cache = new Map<number, [number, number, number]>();
      const vertex = (vi: number): [number, number, number] => {
        let c = cache.get(vi);
        if (!c) {
          const x = position.getX(vi) + tx;
          const y = position.getY(vi) + ty;
          const z = position.getZ(vi) + tz;
          c = [x * A[0] + y * A[1] + z * A[2], x * B[0] + y * B[1] + z * B[2], Math.hypot(x, y, z)];
          // Vertices on the far side project onto the same footprint; mark them so their triangles are skipped.
          if (x * site.centre[0] + y * site.centre[1] + z * site.centre[2] < 0.9 * plateau) c[2] = Number.NaN;
          cache.set(vi, c);
        }
        return c;
      };
      let hits = 0;
      let maxDev = 0;
      let maxEdge = 0;
      for (let t = 0; t < geometry.indexCount; t += 3) {
        const P = [0, 1, 2].map((k) => vertex(index.getX(geometry.indexStart + t + k)));
        if (Number.isNaN(P[0][2] + P[1][2] + P[2][2])) continue;
        const amin = Math.min(P[0][0], P[1][0], P[2][0]);
        const amax = Math.max(P[0][0], P[1][0], P[2][0]);
        const bmin = Math.min(P[0][1], P[1][1], P[2][1]);
        const bmax = Math.max(P[0][1], P[1][1], P[2][1]);
        if (amax < -1000 || amin > 1000 || bmax < -23 || bmin > 23) continue;
        const d = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
        if (Math.abs(d) < 1e-9) continue;
        for (const [a, b] of samples) {
          if (a < amin || a > amax || b < bmin || b > bmax) continue;
          const l0 = ((P[1][1] - P[2][1]) * (a - P[2][0]) + (P[2][0] - P[1][0]) * (b - P[2][1])) / d;
          const l1 = ((P[2][1] - P[0][1]) * (a - P[2][0]) + (P[0][0] - P[2][0]) * (b - P[2][1])) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const r = l0 * P[0][2] + l1 * P[1][2] + l2 * P[2][2];
          hits += 1;
          maxDev = Math.max(maxDev, Math.abs(r - plateau));
          maxEdge = Math.max(maxEdge, Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]), Math.hypot(P[1][0] - P[2][0], P[1][1] - P[2][1]));
        }
      }
      if (hits) {
        rows.push({ verts: geometry.vertexCount, hits, maxDevM: +maxDev.toFixed(2), maxEdgeM: Math.round(maxEdge) });
        total += hits;
        worst = Math.max(worst, maxDev);
      }
    }
    return { patches: rows.length, samples: total, maxDevM: +worst.toFixed(2), rows };
  }

  setViewMode(mode: ForestViewMode): void {
    this.viewMode.set(mode);
  }

  setFadeStart(event: Event): void {
    this.fadeStartM.set(+(event.target as HTMLInputElement).value);
  }

  setFadeWidth(event: Event): void {
    this.fadeWidthM.set(+(event.target as HTMLInputElement).value);
  }

  /** Sets the fade band from the tree size and the pixel rule (see `forestFadeBand`). */
  resetFadeBand(): void {
    this.fadeStartM.set(Math.round(this.forestBand.startM));
    this.fadeWidthM.set(Math.round(this.forestBand.endM - this.forestBand.startM));
  }

  setDensityScale(event: Event): void {
    this.densityScale.set(+(event.target as HTMLInputElement).value);
  }

  setShadowSteps(steps: number): void {
    this.shadowSteps.set(steps);
  }

  /** Altitude slider: log scale from 30 m to 40 km, for a slow zoom through the fade band. */
  setAltitudeLog(event: Event): void {
    const t = +(event.target as HTMLInputElement).value;
    this.jump(Math.round(30 * Math.pow(40_000 / 30, t)));
  }

  readonly altitudeLog = computed(() => Math.log(this.altitudeM() / 30) / Math.log(40_000 / 30));

  setTop(on: boolean): void {
    this.top.set(on);
    this.jump(this.altitudeM());
  }

  setSunElevation(event: Event): void {
    this.sunElevation.set(+(event.target as HTMLInputElement).value);
  }

  setSunAzimuth(event: Event): void {
    this.sunAzimuth.set(+(event.target as HTMLInputElement).value);
  }

  setExposure(event: Event): void {
    this.exposure.set(+(event.target as HTMLInputElement).value);
  }

  setPaint(event: Event): void {
    this.paintOn.set((event.target as HTMLInputElement).checked);
  }

  switchRunway(mode: RunwayMode): void {
    const params = new URLSearchParams(location.search);
    params.set('runway', mode);
    location.assign(`${location.pathname}?${params}`);
  }
}
