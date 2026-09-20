import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  EngineModule,
  RaycastFocusContext,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import { DoubleSide, MeshStandardMaterial, Vector3 } from 'three';
import {
  ITerrainField,
  ITerrainFieldSample,
  ITerrainPatchMesh,
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  TerrainSurfaceComponent,
  type ILatLonTerrainPatchAddress,
  type TerrainSurfaceMeshGenerator,
  type TerrainSurfacePatchSelector,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  enablePlanetMorphProjection,
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  type IDynamicProjectionUniforms,
  type MapProjectionKind,
} from 'triangular-engine/worldgen/render';
import type { IVec3, WorldProfileKind } from 'triangular-engine/worldgen';
import {
  CELL_PLANET_U0_FIXTURE,
  type CellPlanetU0BookmarkId,
  type ICellPlanetU0Bookmark,
} from '../cell-planet-u0-fixture';
import type {
  CellPlanetMorphWorkerRequest,
  CellPlanetMorphWorkerTimings,
} from './cell-planet-morph-streaming.worker';

type Quality = 'standard' | 'high' | 'ultra';
type ColourMode = 'natural' | 'elevation' | 'plates' | 'lod';

interface QualityPreset {
  readonly maxLod: number;
  readonly resolution: number;
  readonly budget: number;
  readonly maxPatches: number;
  readonly reduction: number;
}

const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = {
  standard: {
    maxLod: 5,
    resolution: 24,
    budget: 4,
    maxPatches: 80,
    reduction: 0.35,
  },
  high: {
    maxLod: 7,
    resolution: 32,
    budget: 6,
    maxPatches: 140,
    reduction: 0.35,
  },
  ultra: {
    maxLod: 8,
    resolution: 40,
    budget: 8,
    maxPatches: 220,
    reduction: 0.25,
  },
};

class StreamingDummyField implements ITerrainField {
  readonly minElevationM = -350;
  readonly maxElevationM = 520;
  sample(_point: TerrainVector3): ITerrainFieldSample {
    return { elevationM: 0 };
  }
  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    output.fill(0);
    return output;
  }
}

function addressKey(addr: ILatLonTerrainPatchAddress): string {
  return `${addr.level}:${addr.x}:${addr.y}`;
}

function addressLevel(addr: ILatLonTerrainPatchAddress): number {
  return addr.level;
}

@Component({
  standalone: true,
  selector: 'app-cell-planet-morph-streaming-page',
  imports: [
    EngineModule,
    RouterLink,
    RaycastOrbitControlsComponent,
    TerrainSurfaceComponent,
  ],
  templateUrl: './cell-planet-morph-streaming-page.component.html',
  styleUrl: './cell-planet-morph-streaming-page.component.scss',
  host: {
    class: 'flex-page',
  },
})
export class CellPlanetMorphStreamingPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly dummyField = new StreamingDummyField();

  // Background Web Worker for non-blocking terrain sampling, edge conforming, and Meshoptimizer
  private readonly terrainWorker = new Worker(
    new URL('./cell-planet-morph-streaming.worker', import.meta.url),
    { type: 'module' },
  );
  private nextWorkerRequestId = 0;
  private readonly workerRequests = new Map<
    number,
    {
      readonly resolve: (
        patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress>,
      ) => void;
      readonly reject: (error: Error) => void;
      readonly startedAt: number;
    }
  >();

  // World parameters matching canonical Cell Planet U0 Fixture
  readonly cellCount = CELL_PLANET_U0_FIXTURE.cellCount;
  readonly seed = signal(CELL_PLANET_U0_FIXTURE.seed);
  readonly worldProfileKind = signal<WorldProfileKind>(
    CELL_PLANET_U0_FIXTURE.worldProfile,
  );
  readonly heightScale = signal(40);
  private heightScaleDebounceTimer?: number;

  // Planet dimensions
  readonly radius = signal(1000);
  readonly domain = computed(
    () => new LatLonTerrainDomain(this.radius(), 4, 2),
  );
  readonly roots = computed(() => this.domain().createLevelZeroRoots());

  // Morph state: 0 = 3D Sphere, 1 = 2.5D Projected Map
  readonly morphProgress = signal(0.0);
  /** Debounced morph factor used by the quadtree LOD selector so rapid slider dragging doesn't thrash meshes */
  readonly lodMorph = signal(0.0);
  private morphLodDebounceTimer?: number;
  readonly isAnimatingMorph = signal(false);

  readonly projectionKind = signal<MapProjectionKind>('equalEarth');
  readonly projectionKinds: readonly MapProjectionKind[] = [
    'equalEarth',
    'equirectangular',
  ];

  // Quality & Simplification
  readonly quality = signal<Quality>('high');
  readonly qualityOptions: readonly Quality[] = ['standard', 'high', 'ultra'];
  readonly qualityConfig = computed(() => QUALITY_PRESETS[this.quality()]);
  readonly reductionPercent = signal(35);
  readonly rebuildRevision = signal(0);

  // Render modes & Diagnostics
  readonly colourMode = signal<ColourMode>('natural');
  readonly colourModes: readonly ColourMode[] = [
    'natural',
    'elevation',
    'plates',
    'lod',
  ];
  readonly wireframe = signal(false);
  readonly freezeLod = signal(false);

  // Official Cell Planet U0 Bookmarks
  readonly bookmarks = CELL_PLANET_U0_FIXTURE.bookmarks;
  readonly activeBookmarkId = signal<CellPlanetU0BookmarkId>('overview');

  // Camera state
  readonly cameraPosition = signal<[number, number, number]>([0, 0, 2600]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);

  // Telemetry signals
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });

  readonly timings = signal<
    CellPlanetMorphWorkerTimings & { readonly workerMs: number }
  >({
    generationMs: 0,
    simplificationMs: 0,
    workerMs: 0,
  });

  // Dynamic projection uniforms for Three.js material
  readonly morphUniforms: IDynamicProjectionUniforms = {
    uMorph: { value: 0 },
    uProjForward: { value: new Vector3(0, 0, 1) },
    uProjUp: { value: new Vector3(0, 1, 0) },
    uProjRight: { value: new Vector3(1, 0, 0) },
    uProjMode: { value: 0 }, // static basis mode: mixes aSpherePos and aFlatPos
    uMapWidth: { value: 2 * Math.PI * 1000 },
    uMapHeight: { value: Math.PI * 1000 },
    uRadius: { value: 1000 },
    uProjectionType: { value: 1 },
  };

  readonly getKey = addressKey;
  readonly getLevel = addressLevel;

  readonly terrainRaycastFocus = (
    context: RaycastFocusContext,
  ): Vector3 | null => {
    const hit = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    )[0];
    return hit?.point ?? null;
  };

  /**
   * Stable patch selector reference: does NOT recreate on every morph tick!
   * This guarantees that existing meshes are NEVER purged or flickered during morph sliding.
   */
  readonly patchSelector: TerrainSurfacePatchSelector<ILatLonTerrainPatchAddress> =
    (request: ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress>) =>
      this.selectPatches(request);

  private previousRefinedKeys = new Set<string>();

  private selectPatches(
    request: ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress>,
  ): readonly ILatLonTerrainPatchAddress[] {
    const domain = this.domain();
    const morph = this.lodMorph();
    const radius = this.radius();
    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;
    const projection =
      this.projectionKind() === 'equirectangular'
        ? EQUIRECTANGULAR_PROJECTION
        : EQUAL_EARTH_PROJECTION;
    const maxLevel = this.qualityConfig().maxLod;
    const baseRefinementDistance = radius * 4.2;

    interface Candidate {
      readonly address: ILatLonTerrainPatchAddress;
      readonly key: string;
      readonly distance: number;
      readonly threshold: number;
      readonly canRefine: boolean;
      readonly priority: number;
    }

    const maxPatches = Math.max(
      request.roots.length,
      Math.floor(request.maxPatches ?? Number.MAX_SAFE_INTEGER),
    );
    const nextRefined = new Set<string>();
    const cam = request.cameraWorldM;

    const measure = (address: ILatLonTerrainPatchAddress): Candidate => {
      const level = address.level;
      const bounds = domain.getPatchBounds(address);
      const u = (bounds.minU + bounds.maxU) * 0.5;
      const v = (bounds.minV + bounds.maxV) * 0.5;

      const dir = domain.getFieldPosition(address, u, v);
      const spherePos: [number, number, number] = [
        dir[0] * radius,
        dir[1] * radius,
        dir[2] * radius,
      ];

      const proj = projection.project(u, v, mapWidth, mapHeight);
      const flatPos: [number, number, number] = [
        proj.x - mapWidth * 0.5,
        mapHeight * 0.5 - proj.y,
        0,
      ];

      const center: [number, number, number] = [
        (1 - morph) * spherePos[0] + morph * flatPos[0],
        (1 - morph) * spherePos[1] + morph * flatPos[1],
        (1 - morph) * spherePos[2] + morph * flatPos[2],
      ];

      const dist = Math.hypot(
        center[0] - cam[0],
        center[1] - cam[1],
        center[2] - cam[2],
      );
      const key = `${address.level}:${address.x}:${address.y}`;
      const wasRefined = this.previousRefinedKeys.has(key);
      const threshold =
        (baseRefinementDistance / Math.pow(2, level)) *
        (wasRefined ? 1.2 : 1.0);

      return {
        address,
        key,
        distance: dist,
        threshold,
        canRefine: level < maxLevel,
        priority: threshold / Math.max(dist, 1),
      };
    };

    // Start with one resident patch per root, then spend the remaining budget
    // on the most screen-relevant leaves. Replacing one leaf with four children
    // costs three additional patches, so the result always stays within the
    // configured maxPatches while remaining a complete quadtree cut.
    const frontier = request.roots.map((root) => measure(root));
    while (frontier.length < maxPatches) {
      let bestIndex = -1;
      let bestPriority = 1;
      for (let index = 0; index < frontier.length; index += 1) {
        const candidate = frontier[index];
        if (!candidate.canRefine || candidate.distance >= candidate.threshold) {
          continue;
        }
        if (candidate.priority > bestPriority) {
          bestIndex = index;
          bestPriority = candidate.priority;
        }
      }

      if (bestIndex < 0) break;

      const [parent] = frontier.splice(bestIndex, 1);
      nextRefined.add(parent.key);
      for (const child of domain.getChildren(parent.address)) {
        frontier.push(measure(child));
      }
    }

    this.previousRefinedKeys = nextRefined;
    return frontier.map((candidate) => candidate.address);
  }

  readonly meshGenerator: TerrainSurfaceMeshGenerator<ILatLonTerrainPatchAddress> =
    (request) => this.generatePatchInWorker(request);

  readonly createMaterial = () => {
    const material = new MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0.05,
      side: DoubleSide,
      vertexColors: true,
    });
    enablePlanetMorphProjection(material, this.morphUniforms);
    return material;
  };

  constructor() {
    this.terrainWorker.onmessage = ({
      data,
    }: MessageEvent<{
      readonly id: number;
      readonly patch?: ITerrainPatchMesh<ILatLonTerrainPatchAddress>;
      readonly timings?: CellPlanetMorphWorkerTimings;
      readonly error?: string;
    }>) => {
      const pending = this.workerRequests.get(data.id);
      if (!pending) return;
      this.workerRequests.delete(data.id);

      if (data.error) {
        pending.reject(new Error(data.error));
      } else if (data.patch) {
        if (data.timings) {
          this.timings.set({
            ...data.timings,
            workerMs: performance.now() - pending.startedAt,
          });
        }
        pending.resolve(data.patch);
      } else {
        pending.reject(new Error('Morph terrain worker returned no patch.'));
      }
    };

    this.terrainWorker.onerror = () => {
      const error = new Error('Morph terrain worker crashed.');
      for (const pending of this.workerRequests.values()) pending.reject(error);
      this.workerRequests.clear();
    };

    this.destroyRef.onDestroy(() => {
      if (this.morphLodDebounceTimer !== undefined) {
        clearTimeout(this.morphLodDebounceTimer);
      }
      if (this.heightScaleDebounceTimer !== undefined) {
        clearTimeout(this.heightScaleDebounceTimer);
      }
      this.terrainWorker.terminate();
      const error = new Error('Morph terrain worker terminated.');
      for (const pending of this.workerRequests.values()) pending.reject(error);
      this.workerRequests.clear();
    });

    // Update GPU uniforms whenever morph or projection changes
    effect(() => {
      const morph = this.morphProgress();
      this.morphUniforms.uMorph.value = morph;
    });

    effect(() => {
      const radius = this.radius();
      this.morphUniforms.uRadius.value = radius;
      this.morphUniforms.uMapWidth.value = 2 * Math.PI * radius;
      this.morphUniforms.uMapHeight.value = Math.PI * radius;
    });

    effect(() => {
      const kind = this.projectionKind();
      this.morphUniforms.uProjectionType.value = kind === 'equalEarth' ? 1 : 0;
    });
  }

  private generatePatchInWorker(
    request: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ILatLonTerrainPatchAddress>> {
    const id = this.nextWorkerRequestId++;
    return new Promise((resolve, reject) => {
      this.workerRequests.set(id, {
        resolve,
        reject,
        startedAt: performance.now(),
      });

      const workerReq: CellPlanetMorphWorkerRequest = {
        id,
        address: request.address,
        radius: this.radius(),
        baseResolution: request.baseResolution ?? request.resolution,
        resolution: request.resolution,
        edgeRefinementMask: request.edgeRefinementMask,
        edgeRefinementLevel: request.edgeRefinementLevel,
        edgeRefinementLevels: request.edgeRefinementLevels,
        edgeRefinementSegments: request.edgeRefinementSegments,
        reduction: this.reductionPercent() / 100,
        targetError: 0.08,
        projectionKind: this.projectionKind(),
        colorMode: this.colourMode(),
        heightScale: this.heightScale(),
        worldProfile: this.worldProfileKind(),
        seed: this.seed(),
      };

      this.terrainWorker.postMessage(workerReq);
    });
  }

  /**
   * Real-time morph slider input:
   * Instantly updates the Three.js shader uniform `uMorph` at 60 FPS on GPU.
   * Existing resident meshes smoothly interpolate between sphere and map with zero mesh re-creation!
   * Debounces the quadtree LOD adjustment by 200ms so sliding never causes meshes to disappear.
   */
  setMorphProgress(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(1, value));
    this.morphProgress.set(clamped);
    this.morphUniforms.uMorph.value = clamped;
    this.updateCameraForActiveBookmark(clamped);

    // Debounce LOD re-selection so moving the slider quickly doesn't thrash the quadtree
    if (this.morphLodDebounceTimer !== undefined) {
      clearTimeout(this.morphLodDebounceTimer);
    }
    this.morphLodDebounceTimer = window.setTimeout(() => {
      this.lodMorph.set(clamped);
    }, 200);
  }

  onMorphSliderChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(1, value));
    if (this.morphLodDebounceTimer !== undefined) {
      clearTimeout(this.morphLodDebounceTimer);
    }
    this.lodMorph.set(clamped);
  }

  animateMorphTo(target: number): void {
    if (this.isAnimatingMorph()) return;
    const start = this.morphProgress();
    const startTime = performance.now();
    const duration = 1600;
    this.isAnimatingMorph.set(true);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const current = start + (target - start) * ease;
      this.morphProgress.set(current);
      this.morphUniforms.uMorph.value = current;
      this.updateCameraForActiveBookmark(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        this.morphProgress.set(target);
        this.morphUniforms.uMorph.value = target;
        this.lodMorph.set(target);
        this.updateCameraForActiveBookmark(target);
        this.isAnimatingMorph.set(false);
      }
    };
    requestAnimationFrame(step);
  }

  toggleMorph(): void {
    const target = this.morphProgress() > 0.5 ? 0.0 : 1.0;
    this.animateMorphTo(target);
  }

  setProjection(kind: MapProjectionKind): void {
    if (this.projectionKind() !== kind) {
      this.projectionKind.set(kind);
      this.rebuildRevision.update((r) => r + 1);
      this.updateCameraForActiveBookmark(this.morphProgress());
    }
  }

  setQuality(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Quality;
    if (value in QUALITY_PRESETS) {
      this.quality.set(value);
      this.reductionPercent.set(
        Math.round(QUALITY_PRESETS[value].reduction * 100),
      );
      this.rebuildRevision.update((r) => r + 1);
    }
  }

  setReduction(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    this.reductionPercent.set(Math.min(95, Math.max(0, Math.round(value))));
    this.rebuildRevision.update((r) => r + 1);
  }

  setHeightScale(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(200, Math.round(value)));
    this.heightScale.set(clamped);

    if (this.heightScaleDebounceTimer !== undefined) {
      clearTimeout(this.heightScaleDebounceTimer);
    }
    this.heightScaleDebounceTimer = window.setTimeout(() => {
      this.rebuildRevision.update((r) => r + 1);
      this.updateCameraForActiveBookmark(this.morphProgress());
    }, 150);
  }

  onHeightScaleChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(200, Math.round(value)));
    if (this.heightScaleDebounceTimer !== undefined) {
      clearTimeout(this.heightScaleDebounceTimer);
    }
    this.heightScale.set(clamped);
    this.rebuildRevision.update((r) => r + 1);
    this.updateCameraForActiveBookmark(this.morphProgress());
  }

  setColourMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ColourMode;
    if (this.colourModes.includes(value)) {
      this.colourMode.set(value);
      this.rebuildRevision.update((r) => r + 1);
    }
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
  }

  toggleFreezeLod(): void {
    this.freezeLod.update((v) => !v);
  }

  jumpToBookmark(bookmarkId: CellPlanetU0BookmarkId): void {
    this.activeBookmarkId.set(bookmarkId);
    this.updateCameraForActiveBookmark(this.morphProgress());
  }

  private updateCameraForActiveBookmark(morph: number): void {
    const bookmarkId = this.activeBookmarkId();
    const bookmark =
      this.bookmarks.find((b) => b.id === bookmarkId) ?? this.bookmarks[0];
    const radius = this.radius();
    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;
    const projection =
      this.projectionKind() === 'equirectangular'
        ? EQUIRECTANGULAR_PROJECTION
        : EQUAL_EARTH_PROJECTION;

    if (bookmark.id === 'overview') {
      const spherePos: [number, number, number] = [0, 0, 2600];
      const flatPos: [number, number, number] = [0, 0, 3600];
      this.cameraPosition.set([
        (1 - morph) * spherePos[0] + morph * flatPos[0],
        (1 - morph) * spherePos[1] + morph * flatPos[1],
        (1 - morph) * spherePos[2] + morph * flatPos[2],
      ]);
      this.cameraTarget.set([0, 0, 0]);
      return;
    }

    const dir: IVec3 = bookmark.direction;
    // Feature height and camera distance scaled with heightScale
    const featureElevation = Math.max(5, this.heightScale() * 0.35);
    const cameraAltitude = radius * (bookmark.cameraRadiusFactor - 1.0) * 0.65;
    const camOffset: [number, number, number] = [-60, 110, 80];

    // Sphere target & camera position
    const r = radius + featureElevation;
    const sphereTarget: [number, number, number] = [
      dir.x * r,
      dir.y * r,
      dir.z * r,
    ];
    const sphereCam: [number, number, number] = [
      dir.x * (r + cameraAltitude) + camOffset[0],
      dir.y * (r + cameraAltitude) + camOffset[1],
      dir.z * (r + cameraAltitude) + camOffset[2],
    ];

    // Flat Map target & camera position
    const lon = Math.atan2(dir.x, dir.z);
    const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const proj = projection.project(lon, lat, mapWidth, mapHeight);
    const flatX = proj.x - mapWidth * 0.5;
    const flatY = mapHeight * 0.5 - proj.y;
    const flatTarget: [number, number, number] = [
      flatX,
      flatY,
      featureElevation,
    ];
    const flatCam: [number, number, number] = [
      flatX + camOffset[0] * 0.8,
      flatY - 140,
      featureElevation + cameraAltitude,
    ];

    // Smooth morphed interpolation between sphere and flat coordinates
    this.cameraPosition.set([
      (1 - morph) * sphereCam[0] + morph * flatCam[0],
      (1 - morph) * sphereCam[1] + morph * flatCam[1],
      (1 - morph) * sphereCam[2] + morph * flatCam[2],
    ]);
    this.cameraTarget.set([
      (1 - morph) * sphereTarget[0] + morph * flatTarget[0],
      (1 - morph) * sphereTarget[1] + morph * flatTarget[1],
      (1 - morph) * sphereTarget[2] + morph * flatTarget[2],
    ]);
  }

  onLodChange(stats: ITerrainSurfaceLodStats): void {
    this.stats.set(stats);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }

  formatMs(val: number): string {
    return `${val.toFixed(1)} ms`;
  }

  formatLevels(levels: Readonly<Record<number, number>>): string {
    return (
      Object.entries(levels)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([l, count]) => `L${l}:${count}`)
        .join(' · ') || '—'
    );
  }
}
