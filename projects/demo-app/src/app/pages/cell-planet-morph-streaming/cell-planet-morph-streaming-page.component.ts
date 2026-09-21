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
import {
  BatchedMesh,
  Box3,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import {
  ITerrainField,
  ITerrainFieldSample,
  ITerrainPatchMesh,
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  getTerrainBatchInstanceIds,
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
  createCellPerPixelLookupUniforms,
  enableCellPerPixelLookup,
  setCellPerPixelLookupEnabled,
  formatDistanceM,
  updateCellPerPixelLookup,
  type ICellPerPixelLookupPayload,
  WORLD_SIZE_TIER_RADIUS_M,
  type IDynamicProjectionUniforms,
  type MapProjectionKind,
} from 'triangular-engine/worldgen/render';
import {
  createTerrainMaterialTileUniforms,
  enableTerrainMaterialTileLookup,
  setTerrainMaterialTileEnabled,
  updateTerrainMaterialTile,
  enableTerrainMacroVariation,
  evaluateTerrainMaterial,
  terrainMaterialColorRgb,
  type ITerrainMaterialTilePayload,
  type ITerrainMaterialTileUniforms,
  type ITerrainMacroVariationUniforms,
} from 'triangular-engine/terrain';
import type { IVec3, WorldProfileKind } from 'triangular-engine/worldgen';
import {
  CELL_PLANET_U0_FIXTURE,
  type CellPlanetU0BookmarkId,
  type ICellPlanetU0Bookmark,
} from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import type {
  CellPlanetMorphWorkerRequest,
  CellPlanetMorphWorkerTimings,
} from './cell-planet-morph-streaming.worker';

type Quality = 'standard' | 'high' | 'ultra';
type ColourMode = 'natural' | 'elevation' | 'plates' | 'lod' | 'material';

interface QualityPreset {
  readonly maxLod: number;
  readonly resolution: number;
  readonly budget: number;
  readonly maxPatches: number;
  readonly reduction: number;
}

interface MorphRaycastBounds {
  readonly bounds: Box3;
}

type MorphRaycastAttribute =
  | import('three').BufferAttribute
  | import('three').InterleavedBufferAttribute;

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
  /** Stylized relief control, kept proportional to the physical planet radius like 25D. */
  readonly heightScale = signal(4);
  readonly terrainHeightScaleM = computed(() =>
    getTerrainHeightScaleM(this.radius(), this.heightScale()),
  );
  private heightScaleDebounceTimer?: number;

  // Planet dimensions
  /** Keep this POC on the same physical medium-planet scale as the 25D reference. */
  readonly radius = signal(WORLD_SIZE_TIER_RADIUS_M.medium);
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
  /** Demo control for the independent material tile; this does not change mesh resolution. */
  readonly materialTileResolution = signal(256);
  readonly materialTileResolutionLabel = computed(
    () => `${this.materialTileResolution()}×${this.materialTileResolution()}`,
  );
  private materialTileDebounceTimer?: number;
  readonly rebuildRevision = signal(0);

  // Render modes & Diagnostics
  readonly colourMode = signal<ColourMode>('natural');
  readonly colourModes: readonly ColourMode[] = [
    'natural',
    'elevation',
    'plates',
    'lod',
    'material',
  ];
  readonly macroVariationEnabled = signal(true);
  // Match the reference page's visible macro-variation starting point.
  readonly macroVariationStrength = signal(1);
  readonly macroVariationScaleM = signal(128);
  readonly wireframe = signal(false);
  readonly freezeLod = signal(false);

  // Official Cell Planet U0 Bookmarks
  readonly bookmarks = CELL_PLANET_U0_FIXTURE.bookmarks;
  readonly activeBookmarkId = signal<CellPlanetU0BookmarkId>('overview');

  // Camera state
  readonly cameraPosition = signal<[number, number, number]>([
    0,
    0,
    WORLD_SIZE_TIER_RADIUS_M.medium * 2.6,
  ]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);
  readonly formatDistanceM = formatDistanceM;

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

  /**
   * The morph material does not use BatchedMesh's `position` attribute for
   * rendering: it mixes `aSpherePos` and `aFlatPos` in the vertex shader.
   * Keep the CPU-side raycast cache tied to the same morph and resident-patch
   * revision so it cannot keep returning a hit on the invisible sphere.
   */
  private morphRaycastSurfaceRevision = 0;
  private morphRaycastCacheMorph = Number.NaN;
  private morphRaycastCacheRevision = -1;
  private morphRaycastBounds = new WeakMap<
    BatchedMesh,
    Map<number, MorphRaycastBounds>
  >();
  private readonly morphRaycastInstanceMatrix = new Matrix4();
  private readonly morphRaycastWorldMatrix = new Matrix4();
  private readonly morphRaycastA = new Vector3();
  private readonly morphRaycastB = new Vector3();
  private readonly morphRaycastC = new Vector3();
  private readonly morphRaycastHit = new Vector3();
  private readonly morphRaycastClosestHit = new Vector3();
  private readonly morphRaycastWorldBounds = new Box3();

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

  private readonly macroUniforms: ITerrainMacroVariationUniforms = {
    uTerrainMacroEnabled: { value: 1 },
    uTerrainMacroStrength: { value: 0.35 },
    uTerrainMacroScaleM: { value: 48 },
  };
  private readonly cellPerPixelUniforms = createCellPerPixelLookupUniforms();
  private readonly terrainMaterialTileUniforms: ITerrainMaterialTileUniforms =
    createTerrainMaterialTileUniforms();
  private terrainMaterialTileReady = false;

  readonly getKey = addressKey;
  readonly getLevel = addressLevel;

  readonly terrainRaycastFocus = (
    context: RaycastFocusContext,
  ): Vector3 | null => {
    const morph = this.morphProgress();
    if (morph > 1e-6) {
      // The generic Three.js raycast reads `position`, which is deliberately
      // kept as the sphere position by the streaming worker. At any non-zero
      // morph that is not the surface drawn by the shader, so raycast the
      // morphed batch attributes directly instead.
      const morphedHit = this.raycastMorphedTerrain(context, morph);
      if (morphedHit) return morphedHit;

      // Do not fall back to the sphere hit: that would reintroduce the
      // invisible/stale zoom plane this resolver is responsible for avoiding.
      return null;
    }

    const hit = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    )[0];
    return hit?.point ?? null;
  };

  private raycastMorphedTerrain(
    context: RaycastFocusContext,
    morph: number,
  ): Vector3 | null {
    if (
      morph !== this.morphRaycastCacheMorph ||
      this.morphRaycastSurfaceRevision !== this.morphRaycastCacheRevision
    ) {
      this.morphRaycastCacheMorph = morph;
      this.morphRaycastCacheRevision = this.morphRaycastSurfaceRevision;
      this.morphRaycastBounds = new WeakMap();
    }

    let closestDistanceSq = Number.POSITIVE_INFINITY;
    let hasHit = false;
    const ray = context.raycaster.ray;

    const visit = (object: import('three').Object3D): void => {
      if (!object.visible) return;
      if ((object as { isBatchedMesh?: boolean }).isBatchedMesh) {
        const mesh = object as BatchedMesh;
        const geometry = mesh.geometry;
        const spherePositions = geometry.getAttribute('aSpherePos');
        const flatPositions = geometry.getAttribute('aFlatPos');
        const index = geometry.index;
        if (!spherePositions || !flatPositions || !index) return;

        mesh.updateMatrixWorld(true);
        const boundsByGeometry = this.getMorphedGeometryBounds(
          mesh,
          spherePositions,
          flatPositions,
          morph,
        );

        for (const instanceId of getTerrainBatchInstanceIds(mesh)) {
          if (!mesh.getVisibleAt(instanceId)) continue;
          const geometryId = mesh.getGeometryIdAt(instanceId);
          const bounds = boundsByGeometry.get(geometryId);
          const range = mesh.getGeometryRangeAt(geometryId);
          if (!bounds || !range) continue;

          mesh.getMatrixAt(instanceId, this.morphRaycastInstanceMatrix);
          this.morphRaycastWorldMatrix.multiplyMatrices(
            mesh.matrixWorld,
            this.morphRaycastInstanceMatrix,
          );
          this.morphRaycastWorldBounds
            .copy(bounds.bounds)
            .applyMatrix4(this.morphRaycastWorldMatrix);
          if (!ray.intersectsBox(this.morphRaycastWorldBounds)) continue;

          const indexEnd = range.indexStart + range.indexCount;
          for (let i = range.indexStart; i < indexEnd; i += 3) {
            const ia = index.getX(i);
            const ib = index.getX(i + 1);
            const ic = index.getX(i + 2);
            this.readMorphedPosition(
              spherePositions,
              flatPositions,
              ia,
              morph,
              this.morphRaycastA,
            ).applyMatrix4(this.morphRaycastWorldMatrix);
            this.readMorphedPosition(
              spherePositions,
              flatPositions,
              ib,
              morph,
              this.morphRaycastB,
            ).applyMatrix4(this.morphRaycastWorldMatrix);
            this.readMorphedPosition(
              spherePositions,
              flatPositions,
              ic,
              morph,
              this.morphRaycastC,
            ).applyMatrix4(this.morphRaycastWorldMatrix);

            const hit = ray.intersectTriangle(
              this.morphRaycastA,
              this.morphRaycastB,
              this.morphRaycastC,
              false,
              this.morphRaycastHit,
            );
            if (!hit) continue;
            const distanceSq = ray.origin.distanceToSquared(hit);
            if (distanceSq < closestDistanceSq) {
              closestDistanceSq = distanceSq;
              this.morphRaycastClosestHit.copy(hit);
              hasHit = true;
            }
          }
        }
        return;
      }

      for (const child of object.children) visit(child);
    };

    const sceneChildren = context.sceneChildren as unknown as import('three').Object3D[];
    for (const child of sceneChildren) {
      visit(child);
    }

    return hasHit ? this.morphRaycastClosestHit.clone() : null;
  }

  private getMorphedGeometryBounds(
    mesh: BatchedMesh,
    spherePositions: MorphRaycastAttribute,
    flatPositions: MorphRaycastAttribute,
    morph: number,
  ): Map<number, MorphRaycastBounds> {
    let boundsByGeometry = this.morphRaycastBounds.get(mesh);
    if (!boundsByGeometry) {
      boundsByGeometry = new Map();
      this.morphRaycastBounds.set(mesh, boundsByGeometry);
    }

    const geometryIds = new Set<number>();
    for (const instanceId of getTerrainBatchInstanceIds(mesh)) {
      if (mesh.getVisibleAt(instanceId)) {
        geometryIds.add(mesh.getGeometryIdAt(instanceId));
      }
    }

    for (const geometryId of geometryIds) {
      if (boundsByGeometry.has(geometryId)) continue;
      const range = mesh.getGeometryRangeAt(geometryId);
      if (!range) continue;

      const bounds = new Box3().makeEmpty();
      const end = range.vertexStart + range.vertexCount;
      for (let vertex = range.vertexStart; vertex < end; vertex++) {
        this.readMorphedPosition(
          spherePositions,
          flatPositions,
          vertex,
          morph,
          this.morphRaycastA,
        );
        bounds.expandByPoint(this.morphRaycastA);
      }
      boundsByGeometry.set(geometryId, {
        bounds,
      });
    }

    return boundsByGeometry;
  }

  private readMorphedPosition(
    spherePositions: MorphRaycastAttribute,
    flatPositions: MorphRaycastAttribute,
    index: number,
    morph: number,
    target: Vector3,
  ): Vector3 {
    const inverseMorph = 1 - morph;
    target.set(
      spherePositions.getX(index) * inverseMorph +
        flatPositions.getX(index) * morph,
      spherePositions.getY(index) * inverseMorph +
        flatPositions.getY(index) * morph,
      spherePositions.getZ(index) * inverseMorph +
        flatPositions.getZ(index) * morph,
    );
    return target;
  }

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

    enableTerrainMacroVariation(material, this.macroUniforms, {
      // The demo has always broken up the *visible* (morphed) surface, so keep
      // view space here; the main-game switch uses the morph-stable default.
      positionSpace: 'viewM',
    });
    enablePlanetMorphProjection(material, this.morphUniforms);
    enableCellPerPixelLookup(material, this.cellPerPixelUniforms);
    enableTerrainMaterialTileLookup(material, this.terrainMaterialTileUniforms);
    return material;
  };

  constructor() {
    this.terrainWorker.onmessage = ({
      data,
    }: MessageEvent<{
      readonly id: number;
      readonly patch?: ITerrainPatchMesh<ILatLonTerrainPatchAddress>;
      readonly cellLookup?: ICellPerPixelLookupPayload;
      readonly materialTile?: ITerrainMaterialTilePayload;
      readonly timings?: CellPlanetMorphWorkerTimings;
      readonly error?: string;
    }>) => {
      const pending = this.workerRequests.get(data.id);
      if (!pending) return;
      this.workerRequests.delete(data.id);

      if (data.error) {
        pending.reject(new Error(data.error));
      } else if (data.patch) {
        if (data.materialTile) {
          updateTerrainMaterialTile(this.terrainMaterialTileUniforms, data.materialTile);
          this.terrainMaterialTileReady = true;
          setCellPerPixelLookupEnabled(this.cellPerPixelUniforms, false);
        } else if (data.cellLookup) {
          updateCellPerPixelLookup(this.cellPerPixelUniforms, data.cellLookup);
          setTerrainMaterialTileEnabled(this.terrainMaterialTileUniforms, false);
        } else {
          if (this.colourMode() === 'material') {
            setTerrainMaterialTileEnabled(
              this.terrainMaterialTileUniforms,
              this.terrainMaterialTileReady,
            );
          } else {
            setCellPerPixelLookupEnabled(this.cellPerPixelUniforms, false);
            setTerrainMaterialTileEnabled(this.terrainMaterialTileUniforms, false);
          }
        }
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
      if (this.materialTileDebounceTimer !== undefined) {
        clearTimeout(this.materialTileDebounceTimer);
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

    effect(() => {
      this.macroUniforms.uTerrainMacroEnabled.value =
        this.colourMode() === 'material' && this.macroVariationEnabled() ? 1 : 0;
      this.macroUniforms.uTerrainMacroStrength.value = Math.max(
        0,
        Math.min(1, this.macroVariationStrength()),
      );
      this.macroUniforms.uTerrainMacroScaleM.value = Math.max(
        1,
        this.macroVariationScaleM(),
      );
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
        materialTileResolution: this.materialTileResolution(),
        heightScale: this.terrainHeightScaleM(),
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

  setMaterialTileResolution(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const resolution = Math.max(64, Math.min(1024, Math.round(value / 64) * 64));
    this.materialTileResolution.set(resolution);

    if (this.materialTileDebounceTimer !== undefined) {
      clearTimeout(this.materialTileDebounceTimer);
    }
    this.materialTileDebounceTimer = window.setTimeout(() => {
      this.rebuildRevision.update((revision) => revision + 1);
    }, 180);
  }

  setHeightScale(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(14, value));
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
    const clamped = Math.max(0, Math.min(14, value));
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
      setTerrainMaterialTileEnabled(
        this.terrainMaterialTileUniforms,
        value === 'material' && this.terrainMaterialTileReady,
      );
      this.rebuildRevision.update((r) => r + 1);
    }
  }

  setMacroVariationEnabled(event: Event): void {
    this.macroVariationEnabled.set((event.target as HTMLInputElement).checked);
  }

  setMacroVariationStrength(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.macroVariationStrength.set(Math.max(0, Math.min(1, value)));
    }
  }

  setMacroVariationScale(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.macroVariationScaleM.set(Math.max(8, Math.min(128, value)));
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
      const spherePos: [number, number, number] = [0, 0, radius * 2.6];
      const flatPos: [number, number, number] = [0, 0, radius * 3.6];
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
    const featureElevation = Math.max(5, this.terrainHeightScaleM() * 0.35);
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
    // TerrainSurface emits only when resident geometry changes. Invalidate
    // morphed bounds at that boundary so reused BatchedMesh ranges are never
    // tested against bounds from a previous dynamic-LOD patch.
    this.morphRaycastSurfaceRevision++;
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
