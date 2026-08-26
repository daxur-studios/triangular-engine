import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ICelestialBody,
  ISurfaceSampler,
  Vec3d,
  bodyOrientationAt,
  createSurfaceSampler,
} from 'triangular-engine/celestial';
import { EngineService, GroupComponent, provideObject3DComponent } from 'triangular-engine';
import {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Quaternion,
  QuaternionTuple,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector3Tuple,
  WebGLRenderer,
} from 'three';
import {
  CDLOD_CUBE_FACES,
  computePatchCenterAndRadii,
  ICdlodPatch,
  ICdlodSelectionOptions,
  IPlanetPatchAddress,
  selectCdlodPatches,
} from './cdlod-quadtree';
import { CdlodMotionLookAhead } from './cdlod-motion-prediction';
import {
  createCubesphereOceanGeometry,
  generateCdlodOceanPatchGeometry,
  generateCdlodPatchGeometry,
  reconstructCdlodBufferGeometry,
} from './cdlod-patch-mesher';
import { CdlodWorkerPool } from './cdlod-worker-pool';
import {
  createCdlodTerrainMaterial,
  createOceanMaterial,
  getTerrainPaletteForBody,
  ICdlodShaderUniforms,
  ICdlodTerrainPalette,
  IOceanShaderUniforms,
} from './cdlod-materials';
import { PlanetaryFeaturePyramid, CdlodV3Selector } from './v3';

// Minimum spacing between reselects triggered by worker patches arriving.
// Each in-flight worker patch resolves independently, so bursts of up to
// ~16 completions can land on separate frames milliseconds apart. Without
// this, each one bypassed the normal selection throttle (#needsImmediateRebuild
// short-circuits it), forcing a full quadtree reselect over the whole planet
// per arrival — readiness state shifts slightly between each of those
// back-to-back reselects, so the resulting active-patch set can differ each
// time, which reads as the ground repeatedly popping in and out.
const WORKER_REBUILD_DEBOUNCE_MS = 80;

export type QualityPresetId = 'laptop' | 'balanced' | 'ultra';

export interface IQualityPreset {
  id: QualityPresetId;
  name: string;
  description: string;
  splitErrorPx: number;
  mergeErrorPx: number;
  screenSpaceFactorPx: number;
  baseResolution: number;
  maxLevel: number;
}

export const QUALITY_PRESETS: readonly IQualityPreset[] = [
  {
    id: 'laptop',
    name: 'Laptop / Fast',
    description:
      'Lightweight (~25k-60k tris) — 16-quad grids, smooth orbit & high battery life (165+ FPS).',
    splitErrorPx: 12,
    mergeErrorPx: 6,
    screenSpaceFactorPx: 750,
    baseResolution: 16,
    maxLevel: 10,
  },
  {
    id: 'balanced',
    name: 'Balanced / High',
    description:
      'Standard (~70k-150k tris) — 32-quad grids, crisp globe from space and ground crags matching physics.',
    splitErrorPx: 8,
    mergeErrorPx: 4,
    screenSpaceFactorPx: 850,
    baseResolution: 32,
    maxLevel: 12,
  },
  {
    id: 'ultra',
    name: 'Ultra / Desktop',
    description:
      'Cinematic LOD (~150k-300k tris) — 64-quad grids, pristine planetary globe and ultra dense rugged terrain.',
    splitErrorPx: 5,
    mergeErrorPx: 2,
    screenSpaceFactorPx: 1000,
    baseResolution: 64,
    maxLevel: 13,
  },
];

export interface ICdlodTelemetry {
  activeTriangles: number;
  activePatches: number;
  drawCalls: number;
  cameraAltitudeM: number;
  highDetailCount: number;
  coarseCount: number;
  fps: number;
  levelCounts?: Record<number, number>;
}

interface IResidentPatchMesh {
  id: string;
  mesh: Mesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
}

/**
 * Declarative CDLOD Planetary Terrain Component.
 *
 * Provides Continuous Distance-Dependent Level of Detail with GPU vertex geomorphing,
 * roughness-adaptive decimation, motion look-ahead, and worker acceleration.
 */
@Component({
  standalone: true,
  selector: 'cdlodPlanet, app-cdlod-planet',
  imports: [],
  template: '<ng-content></ng-content>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideObject3DComponent(CdlodPlanetComponent)],
})
export class CdlodPlanetComponent extends GroupComponent implements OnDestroy {
  // Child scene graph groups
  private readonly terrainGroup = new Group();
  private readonly oceanGroup = new Group();

  // Active resident Three.js mesh maps
  private readonly residentTerrainMeshes = new Map<
    string,
    IResidentPatchMesh
  >();
  private readonly residentOceanMeshes = new Map<string, IResidentPatchMesh>();

  // ==========================================================================
  // Inputs
  // ==========================================================================

  readonly body = input.required<ICelestialBody>();
  readonly localPosition = input<Vector3Tuple | null>(null);
  readonly bodyQuaternionOverride = input<QuaternionTuple | null>(null);
  readonly renderOriginBodyFixedM = input<Vec3d | null>(null);
  readonly quality = input<QualityPresetId>('balanced');
  readonly splitErrorPx = input<number | null>(null);
  readonly mergeErrorPx = input<number | null>(null);
  readonly screenSpaceFactorPx = input<number | null>(null);
  readonly baseResolution = input<number | null>(null);
  readonly maxLevel = input<number | null>(null);
  readonly wireframe = input(false);
  readonly hidePatchEdges = input(false);
  readonly featureAdaptive = input(true);
  readonly cdlodMorphing = input(true);
  readonly showTerrain = input(true);
  readonly showOcean = input(true);
  readonly debugLodColor = input(false);
  readonly freezeLod = input(false);
  readonly useWorkers = input(true);
  readonly workerFactory = input<(() => Worker) | null>(null);
  readonly sunDirection = input<Vector3Tuple>([10, 20, 10]);
  readonly sunColor = input<Vector3Tuple | string>([1, 0.98, 0.92]);
  readonly ambientColor = input<Vector3Tuple | string>([0.22, 0.24, 0.3]);
  readonly castShadow = input(true);
  readonly receiveShadow = input(true);
  readonly hidden = input(false);
  readonly palette = input<ICdlodTerrainPalette | null>(null);
  readonly motionLookAhead = input<CdlodMotionLookAhead | null>(null);
  readonly engineVersion = input<'v2' | 'v3'>('v2');

  // ==========================================================================
  // Outputs
  // ==========================================================================

  readonly telemetry = output<ICdlodTelemetry>();

  // ==========================================================================
  // Effective Computeds
  // ==========================================================================

  readonly bodyQuaternion = computed<QuaternionTuple>(() => {
    const override = this.bodyQuaternionOverride();
    if (override) return override;
    const b = this.body();
    const q = bodyOrientationAt(b, 0);
    return [q[0], q[1], q[2], q[3]];
  });

  readonly effectiveQuality = computed<IQualityPreset>(() => {
    const qId = this.quality();
    const preset =
      QUALITY_PRESETS.find((p) => p.id === qId) ?? QUALITY_PRESETS[1];
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      splitErrorPx: this.splitErrorPx() ?? preset.splitErrorPx,
      mergeErrorPx: this.mergeErrorPx() ?? preset.mergeErrorPx,
      screenSpaceFactorPx:
        this.screenSpaceFactorPx() ?? preset.screenSpaceFactorPx,
      baseResolution: this.baseResolution() ?? preset.baseResolution,
      maxLevel: this.maxLevel() ?? preset.maxLevel,
    };
  });

  readonly sampler = computed<ISurfaceSampler>(() => {
    return createSurfaceSampler(this.body());
  });

  readonly activePalette = computed<ICdlodTerrainPalette>(() => {
    const custom = this.palette();
    if (custom) return custom;
    return getTerrainPaletteForBody(this.body());
  });

  readonly activeRenderOrigin = computed<Vec3d>(() => {
    const override = this.renderOriginBodyFixedM();
    if (override) return override;
    const pos = this.localPosition() ?? this.position();
    return [-pos[0], -pos[1], -pos[2]];
  });

  // Fallback Materials
  readonly #fallbackMaterial = createCdlodTerrainMaterial({ wireframe: true });
  readonly #fallbackOceanMaterial = createOceanMaterial({ wireframe: true });

  // Worker Pool & Caches
  #workerPool: CdlodWorkerPool | undefined;
  readonly #inFlightRequests = new Set<string>();
  readonly #readyGeometryIds = new Set<string>();
  #previouslySplitAddresses = new Set<string>();

  #getOrCreateWorkerPool(): CdlodWorkerPool {
    if (!this.#workerPool) {
      const factory = this.workerFactory();
      this.#workerPool = new CdlodWorkerPool(
        factory ? { workerFactory: factory } : undefined,
      );
    }
    return this.#workerPool;
  }

  // One shared material per planet instance — every patch reuses it (patch-specific
  // morph uniforms are pushed via each mesh's onBeforeRender, not baked per-material).
  // Geometry differs per patch, so it stays keyed by patch id.
  #terrainMaterial: ShaderMaterial | undefined;
  #oceanMaterial: ShaderMaterial | undefined;
  readonly #geometryCache = new Map<string, BufferGeometry>();
  readonly #patchMinElevationM = new Map<string, number>();
  readonly #oceanGeometryCache = new Map<string, BufferGeometry>();
  #pendingWorkerRebuild = false;

  #v3Pyramid: PlanetaryFeaturePyramid | undefined;
  #v3PyramidBody: ICelestialBody | undefined;
  #v3Selector: CdlodV3Selector | undefined;

  #lastCameraPos = new Vector3(NaN, NaN, NaN);
  #lastCameraFwd = new Vector3(0, 0, -1);
  #lastSelectionTimeMs = 0;
  #currentCameraBodyFixedM: Vec3d = [0, 0, 0];
  #lastFrameTimestamp = performance.now();
  #frameCount = 0;
  #currentFps = 0;
  #needsImmediateRebuild = true;

  constructor() {
    super();
    const group = this.object3D() as Group;
    group.add(this.terrainGroup);
    group.add(this.oceanGroup);

    // Structural definition changes: Clear all geometry and material caches
    effect(() => {
      this.body();
      this.effectiveQuality();
      this.#clearGeometryCache();
      this.#clearMaterialCache();
      this.#clearResidentMeshes();
      this.#needsImmediateRebuild = true;
    });

    // Material visual toggles: Instantly update the shared terrain/ocean materials
    effect(() => {
      const wire = this.wireframe();
      const terrainMat = this.#terrainMaterial;
      if (terrainMat) {
        terrainMat.wireframe = wire;
        terrainMat.needsUpdate = true;
        const u = terrainMat.uniforms as unknown as ICdlodShaderUniforms;
        if (u?.uWireframeMode) {
          u.uWireframeMode.value = wire ? 1.0 : 0.0;
        }
      }
      const oceanMat = this.#oceanMaterial;
      if (oceanMat) {
        oceanMat.wireframe = wire;
        oceanMat.needsUpdate = true;
        const u = oceanMat.uniforms as unknown as IOceanShaderUniforms;
        if (u?.uWireframeMode) {
          u.uWireframeMode.value = wire ? 1.0 : 0.0;
        }
      }
    });

    effect(() => {
      const hide = this.hidePatchEdges();
      const debugLod = this.debugLodColor();
      const u = this.#terrainMaterial?.uniforms as unknown as
        | ICdlodShaderUniforms
        | undefined;
      if (u?.uHidePatchEdges) {
        u.uHidePatchEdges.value = hide ? 1.0 : 0.0;
      }
      if (u?.uDebugLodColor) {
        u.uDebugLodColor.value = debugLod ? 1.0 : 0.0;
      }
    });

    // Sync input localPosition / bodyQuaternionOverride to Object3D model signals
    effect(() => {
      const lp = this.localPosition();
      if (lp) {
        this.position.set(lp);
      }
    });

    effect(() => {
      const bq = this.bodyQuaternionOverride();
      if (bq) {
        this.quaternion.set(bq);
      }
    });

    effect(() => {
      const isHidden = this.hidden();
      const obj = this.object3D();
      if (obj) {
        obj.visible = !isHidden;
      }
    });

    // Runtime quadtree & motion updates
    effect(() => {
      this.showTerrain();
      this.showOcean();
      this.cdlodMorphing();
      this.featureAdaptive();
      this.useWorkers();
      this.activeRenderOrigin();
      this.motionLookAhead();
      this.#needsImmediateRebuild = true;
    });

    // React to body / terrain parameter updates
    effect(() => {
      this.body();
      this.#clearGeometryCache();
      this.#clearResidentMeshes();
      this.#v3Selector = undefined;
      this.#v3Pyramid = undefined;
      this.#needsImmediateRebuild = true;
    });

    // Tick subscription
    this.engineService.postTick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.#onPostTick(performance.now());
      });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    if (this.#workerPool) {
      this.#workerPool.terminate();
      this.#workerPool = undefined;
    }
    this.#clearGeometryCache();
    this.#clearMaterialCache();
    this.#clearResidentMeshes();
    this.#fallbackMaterial.dispose();
    this.#fallbackOceanMaterial.dispose();
  }

  #ensureRootGeometries(): void {
    const body = this.body();
    const sampler = this.sampler();
    const res = this.effectiveQuality().baseResolution;

    for (const face of CDLOD_CUBE_FACES) {
      const addr: IPlanetPatchAddress = { face, level: 0, x: 0, y: 0 };
      const id = `${face}:0:0:0:${res}`;
      const { center } = computePatchCenterAndRadii(body, sampler, addr);

      if (!this.#geometryCache.has(id)) {
        const meshResult = generateCdlodPatchGeometry(
          body,
          sampler,
          addr,
          res,
          center,
        );
        this.#geometryCache.set(id, meshResult.geometry);
        this.#patchMinElevationM.set(id, meshResult.minElevationM);
        this.#readyGeometryIds.add(id);
      }

      if (this.showOcean() && body.terrain?.ocean) {
        const oceanId = `ocean:${id}`;
        if (!this.#oceanGeometryCache.has(oceanId)) {
          const oceanResult = generateCdlodOceanPatchGeometry(
            body,
            addr,
            res,
            center,
          );
          this.#oceanGeometryCache.set(oceanId, oceanResult.geometry);
        }
      }
    }
  }

  #clearGeometryCache(): void {
    for (const geom of this.#geometryCache.values()) {
      geom.dispose();
    }
    this.#geometryCache.clear();
    this.#readyGeometryIds.clear();
    this.#patchMinElevationM.clear();
    for (const geom of this.#oceanGeometryCache.values()) {
      geom.dispose();
    }
    this.#oceanGeometryCache.clear();
    this.#inFlightRequests.clear();
    this.#previouslySplitAddresses = new Set<string>();
    this.#lastCameraPos.set(NaN, NaN, NaN);
    this.#ensureRootGeometries();
  }

  #clearMaterialCache(): void {
    this.#terrainMaterial?.dispose();
    this.#terrainMaterial = undefined;
    this.#oceanMaterial?.dispose();
    this.#oceanMaterial = undefined;
  }

  #clearResidentMeshes(): void {
    for (const resident of this.residentTerrainMeshes.values()) {
      this.terrainGroup.remove(resident.mesh);
    }
    this.residentTerrainMeshes.clear();

    for (const resident of this.residentOceanMeshes.values()) {
      this.oceanGroup.remove(resident.mesh);
    }
    this.residentOceanMeshes.clear();
  }

  #onPostTick(time: number): void {
    this.#frameCount++;
    if (time - this.#lastFrameTimestamp >= 500) {
      this.#currentFps = Math.round(
        (this.#frameCount * 1000) / (time - this.#lastFrameTimestamp),
      );
      this.#frameCount = 0;
      this.#lastFrameTimestamp = time;
    }

    if (this.hidden()) return;

    const camera = this.engineService.camera;
    if (!camera) return;

    const camWorldPos = new Vector3();
    camera.getWorldPosition(camWorldPos);

    const planetWorldPos = new Vector3();
    this.object3D().getWorldPosition(planetWorldPos);

    const planetWorldQuat = new Quaternion();
    this.object3D().getWorldQuaternion(planetWorldQuat);
    const invPlanetQuat = planetWorldQuat.clone().conjugate();

    const camRelativeWorld = camWorldPos.sub(planetWorldPos);
    camRelativeWorld.applyQuaternion(invPlanetQuat);
    const cameraPosBodyFixed: Vec3d = [
      camRelativeWorld.x,
      camRelativeWorld.y,
      camRelativeWorld.z,
    ];

    const camFwd = new Vector3();
    camera.getWorldDirection(camFwd);
    camFwd.applyQuaternion(invPlanetQuat);
    const cameraFwdBodyFixed: Vec3d = [camFwd.x, camFwd.y, camFwd.z];

    this.#currentCameraBodyFixedM = cameraPosBodyFixed;

    const currentCamPosVec = new Vector3(...cameraPosBodyFixed);
    const currentCamFwdVec = new Vector3(...cameraFwdBodyFixed);
    const camPosDelta = currentCamPosVec.distanceTo(this.#lastCameraPos);
    const camFwdAngle = currentCamFwdVec.angleTo(this.#lastCameraFwd);
    const timeSinceSelect = time - this.#lastSelectionTimeMs;

    const camDistM = Math.hypot(...this.#currentCameraBodyFixedM);
    const distanceRadii = camDistM / Math.max(1, this.body().radiusM);
    const isNearGround = camDistM - this.body().radiusM < 50_000;
    const isFarDistant = distanceRadii > 15.0;

    const movementThresholdM = isNearGround
      ? 2.5
      : isFarDistant
        ? this.body().radiusM * 0.25
        : 25.0;
    const fwdAngleThreshold = isFarDistant ? 0.35 : 0.08;

    const shouldSelect =
      this.#needsImmediateRebuild ||
      (this.#pendingWorkerRebuild &&
        timeSinceSelect > WORKER_REBUILD_DEBOUNCE_MS) ||
      (!this.freezeLod() &&
        (camPosDelta > movementThresholdM ||
          camFwdAngle > fwdAngleThreshold));

    if (shouldSelect) {
      this.#needsImmediateRebuild = false;
      this.#pendingWorkerRebuild = false;
      this.#lastCameraPos.copy(currentCamPosVec);
      this.#lastCameraFwd.copy(currentCamFwdVec);
      this.#lastSelectionTimeMs = time;

      this.#executeSelection(this.#currentCameraBodyFixedM, cameraFwdBodyFixed);
    }

    this.#updateUniforms();
  }

  #executeSelection(cameraPosM: Vec3d, cameraFwd: Vec3d): void {
    const body = this.body();
    const sampler = this.sampler();
    const quality = this.effectiveQuality();
    const alt = Math.hypot(...cameraPosM) - body.radiusM;

    if (this.engineVersion() === 'v3') {
      if (!this.#v3Pyramid || this.#v3PyramidBody !== body) {
        this.#v3Pyramid = new PlanetaryFeaturePyramid(body, sampler, {
          maxLevel: 6,
        });
        this.#v3PyramidBody = body;
        this.#v3Selector = new CdlodV3Selector(body, this.#v3Pyramid, sampler);
      }
      const selector = this.#v3Selector!;
      const v3Patches = selector.selectPatches(cameraPosM, {
        splitErrorPx: quality.splitErrorPx,
        viewportHeightPx: 1080,
        fovRad: (60 * Math.PI) / 180,
        maxLevel: quality.maxLevel,
        baseResolution: quality.baseResolution,
      });

      const cdlodPatches: ICdlodPatch[] = v3Patches.map((p) => ({
        address: p.address,
        centerBodyFixedM: p.centerBodyFixedM,
        boundingRadiusM: p.boundingRadiusM,
        resolution: p.resolution,
        morphFactor: p.morphFactor,
        edgeMorph: p.edgeMorph,
        roughnessM: p.varianceM,
        distanceM: Math.hypot(
          cameraPosM[0] - p.centerBodyFixedM[0],
          cameraPosM[1] - p.centerBodyFixedM[1],
          cameraPosM[2] - p.centerBodyFixedM[2],
        ),
        minRadiusM: body.radiusM + p.minElevationM,
        maxRadiusM: body.radiusM + p.maxElevationM,
      }));

      for (const p of v3Patches) {
        const key = `${p.address.face}:${p.address.level}:${p.address.x}:${p.address.y}:${p.resolution}`;
        this.#patchMinElevationM.set(key, p.minElevationM);
      }

      this.#updateResidentMeshes(
        cdlodPatches,
        body,
        sampler,
        quality.baseResolution,
      );
      this.#emitTelemetry(cdlodPatches, alt);
      return;
    }

    const options: ICdlodSelectionOptions = {
      maxLevel: quality.maxLevel,
      baseResolution: quality.baseResolution,
      splitErrorPx: quality.splitErrorPx,
      mergeErrorPx: quality.mergeErrorPx,
      screenSpaceFactorPx: quality.screenSpaceFactorPx,
      morphRangeRatio: 0.35,
      featureAdaptive: this.featureAdaptive(),
    };

    const pool = this.useWorkers() ? this.#getOrCreateWorkerPool() : undefined;
    const isWorkerUsable = this.useWorkers() && pool?.isAvailable;
    const cachedIds = isWorkerUsable ? this.#readyGeometryIds : undefined;

    const selection = selectCdlodPatches({
      body,
      sampler,
      cameraBodyFixedM: cameraPosM,
      cameraForwardDir: cameraFwd,
      altitudeM: alt,
      options,
      previouslySplitAddresses: this.#previouslySplitAddresses,
      cachedGeometries: cachedIds,
      motionLookAhead: this.motionLookAhead(),
    });

    this.#previouslySplitAddresses = selection.splitAddresses;

    if (this.useWorkers() && selection.neededPatches?.length) {
      this.#dispatchWorkerRequests(selection.neededPatches);
    }

    this.#updateResidentMeshes(
      selection,
      body,
      sampler,
      quality.baseResolution,
    );
    this.#emitTelemetry(selection, alt);
  }

  #dispatchWorkerRequests(
    needed: readonly {
      id: string;
      address: IPlanetPatchAddress;
      resolution: number;
      centerBodyFixedM: Vec3d;
    }[],
  ): void {
    const body = this.body();
    const sampler = this.sampler();
    const maxDispatches = 8;
    let dispatched = 0;
    const pool = this.#getOrCreateWorkerPool();

    if (!pool.isAvailable) {
      for (const patch of needed) {
        if (dispatched >= maxDispatches) break;
        if (this.#readyGeometryIds.has(patch.id)) continue;
        dispatched++;
        const meshRes = generateCdlodPatchGeometry(
          body,
          sampler,
          patch.address,
          patch.resolution,
          patch.centerBodyFixedM,
        );
        this.#geometryCache.set(patch.id, meshRes.geometry);
        this.#patchMinElevationM.set(patch.id, meshRes.minElevationM);
        this.#readyGeometryIds.add(patch.id);

        if (this.showOcean() && body.terrain?.ocean) {
          const oceanId = `ocean:${patch.id}`;
          if (!this.#oceanGeometryCache.has(oceanId)) {
            const oceanRes = generateCdlodOceanPatchGeometry(
              body,
              patch.address,
              patch.resolution,
              patch.centerBodyFixedM,
            );
            this.#oceanGeometryCache.set(oceanId, oceanRes.geometry);
          }
        }
      }
      this.#needsImmediateRebuild = true;
      return;
    }

    for (const patch of needed) {
      if (dispatched >= maxDispatches) break;
      if (
        this.#readyGeometryIds.has(patch.id) ||
        this.#inFlightRequests.has(patch.id)
      )
        continue;

      this.#inFlightRequests.add(patch.id);
      dispatched++;

      pool
        .requestPatch({
          id: patch.id,
          type: 'terrain',
          body,
          address: patch.address,
          resolution: patch.resolution,
          centerBodyFixedM: patch.centerBodyFixedM,
        })
        .then((raw) => {
          this.#inFlightRequests.delete(patch.id);
          const geom = reconstructCdlodBufferGeometry(raw);
          this.#geometryCache.set(patch.id, geom);
          this.#patchMinElevationM.set(patch.id, raw.minElevationM);
          this.#readyGeometryIds.add(patch.id);
          this.#pendingWorkerRebuild = true;
        })
        .catch(() => {
          this.#inFlightRequests.delete(patch.id);
          // Fallback to synchronous generation on worker error
          const meshRes = generateCdlodPatchGeometry(
            body,
            sampler,
            patch.address,
            patch.resolution,
            patch.centerBodyFixedM,
          );
          this.#geometryCache.set(patch.id, meshRes.geometry);
          this.#patchMinElevationM.set(patch.id, meshRes.minElevationM);
          this.#readyGeometryIds.add(patch.id);
          this.#pendingWorkerRebuild = true;
        });

      if (this.showOcean() && body.terrain?.ocean) {
        const oceanId = `ocean:${patch.id}`;
        if (
          !this.#oceanGeometryCache.has(oceanId) &&
          !this.#inFlightRequests.has(oceanId)
        ) {
          this.#inFlightRequests.add(oceanId);
          pool
            .requestPatch({
              id: oceanId,
              type: 'ocean',
              body,
              address: patch.address,
              resolution: patch.resolution,
              centerBodyFixedM: patch.centerBodyFixedM,
            })
            .then((raw) => {
              this.#inFlightRequests.delete(oceanId);
              const oceanGeom = reconstructCdlodBufferGeometry(raw);
              this.#oceanGeometryCache.set(oceanId, oceanGeom);
              this.#pendingWorkerRebuild = true;
            })
            .catch(() => {
              this.#inFlightRequests.delete(oceanId);
              const oceanRes = generateCdlodOceanPatchGeometry(
                body,
                patch.address,
                patch.resolution,
                patch.centerBodyFixedM,
              );
              this.#oceanGeometryCache.set(oceanId, oceanRes.geometry);
              this.#pendingWorkerRebuild = true;
            });
        }
      }
    }
  }

  #updateResidentMeshes(
    patches: readonly ICdlodPatch[],
    body: ICelestialBody,
    sampler: ISurfaceSampler,
    baseRes: number,
  ): void {
    const activeTerrainIds = new Set<string>();
    const activeOceanIds = new Set<string>();
    const orig = this.activeRenderOrigin();
    const palette = this.activePalette();
    const wire = this.wireframe();
    const hidePatchEdges = this.hidePatchEdges();
    const morphEnabled = this.cdlodMorphing();

    // 1. Terrain patches
    if (this.showTerrain()) {
      for (const patch of patches) {
        const id = `${patch.address.face}:${patch.address.level}:${patch.address.x}:${patch.address.y}:${patch.resolution}`;
        activeTerrainIds.add(id);

        let resident = this.residentTerrainMeshes.get(id);
        if (!resident) {
          let geom = this.#geometryCache.get(id);
          if (!geom) {
            const meshRes = generateCdlodPatchGeometry(
              body,
              sampler,
              patch.address,
              patch.resolution,
              patch.centerBodyFixedM,
            );
            geom = meshRes.geometry;
            this.#geometryCache.set(id, geom);
            this.#patchMinElevationM.set(id, meshRes.minElevationM);
            this.#readyGeometryIds.add(id);
          }

          if (!this.#terrainMaterial) {
            this.#terrainMaterial = createCdlodTerrainMaterial({
              wireframe: wire,
              hidePatchEdges,
              body,
              palette,
            });
          }
          const mat = this.#terrainMaterial;

          const mesh = new Mesh(geom, mat);
          mesh.castShadow = this.castShadow();
          mesh.receiveShadow = this.receiveShadow();
          // Patch-specific morph uniforms live on the mesh (userData) and are pushed
          // into the shared material right before this mesh's draw call — the
          // material itself is reused by every patch, so it can't hold per-patch state.
          mesh.userData['morphFactor'] = 0;
          mesh.userData['enableMorph'] = 1;
          mesh.userData['edgeMorph'] = [0, 0, 0, 0];
          mesh.userData['lodLevel'] = 0;
          mesh.onBeforeRender = () => {
            const u = mat.uniforms as unknown as ICdlodShaderUniforms;
            const em = mesh.userData['edgeMorph'] as [
              number,
              number,
              number,
              number,
            ];
            u.uMorphFactor.value = mesh.userData['morphFactor'];
            u.uEnableMorph.value = mesh.userData['enableMorph'];
            u.uEdgeMorph.value.set(em[0], em[1], em[2], em[3]);
            u.uLodLevel.value = mesh.userData['lodLevel'];
          };
          this.terrainGroup.add(mesh);

          resident = { id, mesh, geometry: geom, material: mat };
          this.residentTerrainMeshes.set(id, resident);
        }

        // Update transform (body-fixed center relative to body root)
        const c = patch.centerBodyFixedM;
        resident.mesh.position.set(c[0], c[1], c[2]);

        // Update per-patch morph state (consumed by this mesh's onBeforeRender)
        resident.mesh.userData['morphFactor'] = patch.morphFactor;
        resident.mesh.userData['enableMorph'] = morphEnabled ? 1.0 : 0.0;
        resident.mesh.userData['lodLevel'] = patch.address.level;
        resident.mesh.userData['edgeMorph'] = [
          patch.edgeMorph.left,
          patch.edgeMorph.right,
          patch.edgeMorph.bottom,
          patch.edgeMorph.top,
        ];
      }
    }

    // 2. CDLOD ocean patches (exact vertex grid alignment with terrain)
    if (this.showOcean() && body.terrain?.ocean) {
      const seaLevel = body.terrain.ocean.seaLevelM ?? 0;
      for (const patch of patches) {
        const minElev = this.#patchMinElevationM.get(
          `${patch.address.face}:${patch.address.level}:${patch.address.x}:${patch.address.y}:${patch.resolution}`,
        );
        if (minElev !== undefined && minElev > seaLevel + 5) continue;

        const oceanId = `ocean:${patch.address.face}:${patch.address.level}:${patch.address.x}:${patch.address.y}:${patch.resolution}`;
        activeOceanIds.add(oceanId);

        let resident = this.residentOceanMeshes.get(oceanId);
        if (!resident) {
          let geom = this.#oceanGeometryCache.get(oceanId);
          if (!geom) {
            const meshRes = generateCdlodOceanPatchGeometry(
              body,
              patch.address,
              patch.resolution,
              patch.centerBodyFixedM,
            );
            geom = meshRes.geometry;
            this.#oceanGeometryCache.set(oceanId, geom);
          }

          if (!this.#oceanMaterial) {
            this.#oceanMaterial = createOceanMaterial({
              wireframe: wire,
              body,
            });
          }
          const mat = this.#oceanMaterial;

          const mesh = new Mesh(geom, mat);
          mesh.castShadow = false;
          mesh.receiveShadow = this.receiveShadow();
          mesh.renderOrder = 1;
          mesh.userData['morphFactor'] = 0;
          mesh.userData['enableMorph'] = 1;
          mesh.userData['edgeMorph'] = [0, 0, 0, 0];
          mesh.onBeforeRender = () => {
            const u = mat.uniforms as unknown as IOceanShaderUniforms;
            const em = mesh.userData['edgeMorph'] as [
              number,
              number,
              number,
              number,
            ];
            u.uMorphFactor.value = mesh.userData['morphFactor'];
            u.uEnableMorph.value = mesh.userData['enableMorph'];
            u.uEdgeMorph.value.set(em[0], em[1], em[2], em[3]);
          };
          this.oceanGroup.add(mesh);

          resident = { id: oceanId, mesh, geometry: geom, material: mat };
          this.residentOceanMeshes.set(oceanId, resident);
        }

        const c = patch.centerBodyFixedM;
        resident.mesh.position.set(c[0], c[1], c[2]);

        resident.mesh.userData['morphFactor'] = patch.morphFactor;
        resident.mesh.userData['enableMorph'] = morphEnabled ? 1.0 : 0.0;
        resident.mesh.userData['edgeMorph'] = [
          patch.edgeMorph.left,
          patch.edgeMorph.right,
          patch.edgeMorph.bottom,
          patch.edgeMorph.top,
        ];
      }
    }

    // 3. Remove inactive resident meshes. Geometry stays cached indefinitely
    // (only cleared wholesale on structural rebuilds via #clearGeometryCache) —
    // no per-patch eviction.
    for (const [id, resident] of this.residentTerrainMeshes.entries()) {
      if (!activeTerrainIds.has(id)) {
        this.terrainGroup.remove(resident.mesh);
        this.residentTerrainMeshes.delete(id);
      }
    }

    for (const [id, resident] of this.residentOceanMeshes.entries()) {
      if (!activeOceanIds.has(id)) {
        this.oceanGroup.remove(resident.mesh);
        this.residentOceanMeshes.delete(id);
      }
    }
  }

  #updateUniforms(): void {
    const planetWorldPos = new Vector3();
    this.object3D().getWorldPosition(planetWorldPos);
    const renderOriginVec = this.renderOriginBodyFixedM()
      ? new Vector3(...this.renderOriginBodyFixedM()!)
      : planetWorldPos.clone().negate();

    const sunDir = this.sunDirection();
    const sunCol = this.sunColor();
    const ambCol = this.ambientColor();
    const wire = this.wireframe();
    const hidePatchEdges = this.hidePatchEdges();
    const palette = this.activePalette();

    // Global (non-per-patch) uniforms live on the one shared material per group —
    // no need to loop residents, and uMorphFactor/uEnableMorph/uEdgeMorph are left
    // alone here since each mesh's onBeforeRender sets them from its own userData.
    const terrainMat = this.#terrainMaterial;
    if (terrainMat) {
      const u = terrainMat.uniforms as unknown as ICdlodShaderUniforms;
      if (terrainMat.wireframe !== wire) {
        terrainMat.wireframe = wire;
        terrainMat.needsUpdate = true;
      }
      u.uWireframeMode.value = wire ? 1.0 : 0.0;
      u.uHidePatchEdges.value = hidePatchEdges ? 1.0 : 0.0;
      u.uRenderOrigin.value.copy(renderOriginVec);
      u.uSunDirection.value.set(sunDir[0], sunDir[1], sunDir[2]).normalize();
      if (typeof sunCol === 'string') u.uSunColor.value.set(sunCol);
      else u.uSunColor.value.setRGB(sunCol[0], sunCol[1], sunCol[2]);
      if (typeof ambCol === 'string') u.uAmbientColor.value.set(ambCol);
      else u.uAmbientColor.value.setRGB(ambCol[0], ambCol[1], ambCol[2]);

      u.uLowlandColor.value.setRGB(...palette.lowlandColor);
      u.uMidlandColor.value.setRGB(...palette.midlandColor);
      u.uHighlandColor.value.setRGB(...palette.highlandColor);
      u.uPeakColor.value.setRGB(...palette.peakColor);
      u.uCliffColor.value.setRGB(...palette.cliffColor);
      u.uCliffHighColor.value.setRGB(...palette.cliffHighColor);
      u.uShorelineColor.value.setRGB(...palette.shorelineColor);
      u.uSeabedColor.value.setRGB(...palette.seabedColor);
      u.uCliffSlopeThreshold.value = palette.cliffSlopeThreshold;
      u.uStrataFrequency.value = palette.strataFrequency;
      u.uSnowElevationNorm.value = palette.snowElevationNorm;
      u.uDebugLodColor.value = this.debugLodColor() ? 1.0 : 0.0;
    }

    const oceanMat = this.#oceanMaterial;
    if (oceanMat) {
      const u = oceanMat.uniforms as unknown as IOceanShaderUniforms;
      if (oceanMat.wireframe !== wire) {
        oceanMat.wireframe = wire;
        oceanMat.needsUpdate = true;
      }
      u.uWireframeMode.value = wire ? 1.0 : 0.0;
      u.uRenderOrigin.value.copy(renderOriginVec);
      u.uSunDirection.value.set(sunDir[0], sunDir[1], sunDir[2]).normalize();
      if (typeof sunCol === 'string') u.uSunColor.value.set(sunCol);
      else u.uSunColor.value.setRGB(sunCol[0], sunCol[1], sunCol[2]);
      if (typeof ambCol === 'string') u.uAmbientColor.value.set(ambCol);
      else u.uAmbientColor.value.setRGB(ambCol[0], ambCol[1], ambCol[2]);
    }
  }

  #emitTelemetry(patches: readonly ICdlodPatch[], altitudeM: number): void {
    let triCount = 0;
    let highCount = 0;
    let coarseCount = 0;
    const levelCounts: Record<number, number> = {};

    for (const p of patches) {
      triCount += p.resolution * p.resolution * 2;
      levelCounts[p.address.level] = (levelCounts[p.address.level] || 0) + 1;
      if (p.address.level >= 4) highCount++;
      else coarseCount++;
    }

    if (this.showOcean() && this.body().terrain?.ocean) {
      triCount +=
        this.residentOceanMeshes.size *
        (this.effectiveQuality().baseResolution ** 2 * 2);
    }

    const drawCalls =
      this.residentTerrainMeshes.size + this.residentOceanMeshes.size;

    this.telemetry.emit({
      activeTriangles: triCount,
      activePatches: patches.length,
      drawCalls,
      cameraAltitudeM: altitudeM,
      highDetailCount: highCount,
      coarseCount: coarseCount,
      fps: this.#currentFps,
      levelCounts,
    });
  }
}
