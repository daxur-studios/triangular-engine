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
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ICelestialBody,
  ISurfaceSampler,
  Vec3d,
  createCylinderSurfaceSampler,
  HOME_PLANET,
  CdlodMotionLookAhead,
  ICylinderPatchAddress,
  ICdlodCylinderPatch,
  ICdlodCylinderSelectionOptions,
  selectCdlodCylinderPatches,
  generateCdlodCylinderPatchGeometry,
  reconstructCdlodBufferGeometry,
  ICdlodTerrainPalette,
  ICdlodShaderUniforms,
  TERRAIN_PALETTES,
  createCdlodTerrainMaterial,
} from 'triangular-engine/celestial';
import { EngineService } from 'triangular-engine';
import {
  BufferGeometry,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector3Tuple,
} from 'three';
import { CdlodWorkerPool } from './cdlod-worker-pool';
import { ICdlodTelemetry } from './cdlod-planet.component';

interface IResidentPatchMesh {
  id: string;
  mesh: Mesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
}

/**
 * Declarative CDLOD O'Neill Habitat / Interior Cylinder Terrain Component.
 *
 * Provides Continuous Distance-Dependent Level of Detail with GPU vertex geomorphing,
 * circumferential [0, 2pi) periodic quadtree wrapping, inward-curving terrain normal mapping,
 * seamless 3D circle periodic procedural noise, and multi-threaded worker meshing.
 */
@Component({
  standalone: true,
  selector: 'cdlodCylinder, app-cdlod-cylinder',
  imports: [],
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CdlodCylinderComponent implements OnDestroy {
  private readonly engineService = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly rootGroup = new Group();
  private readonly terrainGroup = new Group();
  private readonly residentMeshes = new Map<string, IResidentPatchMesh>();

  // ==========================================================================
  // Inputs
  // ==========================================================================

  readonly sampler = input<ISurfaceSampler | null>(null);
  readonly body = input<ICelestialBody | null>(null);
  readonly radiusM = input<number>(4000);
  readonly rootSectors = input<number>(8);
  readonly rootPatchLengthM = input<number | null>(null);
  readonly axialStreamingRadius = input<number>(3);
  readonly maxLevel = input<number>(6);
  readonly baseResolution = input<number>(32);
  readonly splitErrorPx = input<number>(14);
  readonly mergeErrorPx = input<number>(6);
  readonly screenSpaceFactorPx = input<number>(750);
  readonly morphRangeRatio = input<number>(0.25);
  readonly wireframe = input(false);
  readonly featureAdaptive = input(true);
  readonly cdlodMorphing = input(true);
  readonly freezeLod = input(false);
  readonly useWorkers = input(true);
  readonly workerFactory = input<(() => Worker) | null>(null);
  readonly sunDirection = input<Vector3Tuple>([0, 1, 0]);
  readonly sunColor = input<Vector3Tuple | string>([1, 0.98, 0.92]);
  readonly ambientColor = input<Vector3Tuple | string>([0.3, 0.32, 0.38]);
  readonly palette = input<ICdlodTerrainPalette | null>(null);
  readonly motionLookAhead = input<CdlodMotionLookAhead | null>(null);

  // ==========================================================================
  // Outputs
  // ==========================================================================

  readonly telemetry = output<ICdlodTelemetry>();

  // ==========================================================================
  // State
  // ==========================================================================

  private activeSplitAddresses = new Set<string>();
  private readonly geometryCache = new Map<string, BufferGeometry>();
  private readonly inFlightWorkerRequests = new Set<string>();
  private workerPool: CdlodWorkerPool | null = null;
  private isInitialized = false;

  readonly effectiveSampler = computed<ISurfaceSampler>(() => {
    const s = this.sampler();
    if (s) return s;
    const b = this.body() ?? HOME_PLANET;
    return createCylinderSurfaceSampler(b, this.radiusM());
  });

  readonly activePalette = computed<ICdlodTerrainPalette>(() => {
    return this.palette() ?? TERRAIN_PALETTES['home-planet'];
  });

  constructor() {
    this.rootGroup.name = 'CDLOD_Cylinder_Root';
    this.terrainGroup.name = 'CDLOD_Cylinder_TerrainGroup';
    this.rootGroup.add(this.terrainGroup);

    // Dynamic geometry invalidation effect when cylinder dimensions or parameters change
    effect(() => {
      // Track dependencies
      this.radiusM();
      this.rootSectors();
      this.rootPatchLengthM();
      this.baseResolution();
      this.body();
      this.palette();

      untracked(() => {
        this.clearCachesAndMeshes();
      });
    });

    // Wireframe dynamic synchronization
    effect(() => {
      const isWire = this.wireframe();
      for (const resident of this.residentMeshes.values()) {
        resident.material.wireframe = isWire;
        const uWire = (
          resident.material.uniforms as unknown as ICdlodShaderUniforms
        ).uWireframeMode;
        if (uWire) uWire.value = isWire ? 1.0 : 0.0;
        resident.material.needsUpdate = true;
      }
    });

    // Worker pool lifecycle
    effect(() => {
      const enabled = this.useWorkers();
      const customFactory = this.workerFactory();

      if (this.workerPool) {
        this.workerPool.terminate();
        this.workerPool = null;
      }

      if (enabled && typeof Worker !== 'undefined') {
        const factory =
          customFactory ??
          (() => {
            return new Worker(
              new URL('./cdlod-patch.worker', import.meta.url),
              { type: 'module' },
            );
          });

        this.workerPool = new CdlodWorkerPool({
          workerCount: Math.min(
            4,
            typeof navigator !== 'undefined'
              ? (navigator.hardwareConcurrency ?? 4)
              : 4,
          ),
          workerFactory: factory,
        });
      }
    });

    // Render loop registration
    this.engineService.beforeRender$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.onBeforeRender();
      });

    this.initScene();
  }

  private initScene(): void {
    const scene = this.engineService.scene;
    if (scene && !this.isInitialized) {
      scene.add(this.rootGroup);
      this.isInitialized = true;
    }
  }

  private clearCachesAndMeshes(): void {
    for (const resident of this.residentMeshes.values()) {
      this.terrainGroup.remove(resident.mesh);
      resident.material.dispose();
    }
    this.residentMeshes.clear();

    for (const geom of this.geometryCache.values()) {
      geom.dispose();
    }
    this.geometryCache.clear();

    this.activeSplitAddresses.clear();
    this.inFlightWorkerRequests.clear();
  }

  private onBeforeRender(): void {
    if (!this.isInitialized) {
      this.initScene();
    }

    const camera = this.engineService.camera;
    if (!camera) return;

    const camPosM: Vec3d = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];

    const fwd = new Vector3();
    camera.getWorldDirection(fwd);
    const camFwdDir: Vec3d = [fwd.x, fwd.y, fwd.z];

    const sampler = this.effectiveSampler();
    const radiusM = this.radiusM();
    const rootSectors = this.rootSectors();
    const rootPatchLengthM =
      this.rootPatchLengthM() ?? (2 * Math.PI * radiusM) / rootSectors;

    const options: ICdlodCylinderSelectionOptions = {
      radiusM,
      rootSectors,
      rootPatchLengthM,
      axialStreamingRadius: this.axialStreamingRadius(),
      maxLevel: this.maxLevel(),
      baseResolution: this.baseResolution(),
      splitErrorPx: this.splitErrorPx(),
      mergeErrorPx: this.mergeErrorPx(),
      screenSpaceFactorPx: this.screenSpaceFactorPx(),
      morphRangeRatio: this.morphRangeRatio(),
      featureAdaptive: this.featureAdaptive(),
    };

    if (!this.freezeLod()) {
      const selection = selectCdlodCylinderPatches({
        sampler,
        cameraPositionM: camPosM,
        cameraForwardDir: camFwdDir,
        options,
        previouslySplitAddresses: this.activeSplitAddresses,
        cachedGeometries: new Set(this.geometryCache.keys()),
        motionLookAhead: this.motionLookAhead(),
      });

      this.activeSplitAddresses = new Set(selection.splitAddresses);

      // Dispatch needed background worker requests
      if (
        selection.neededPatches &&
        this.workerPool &&
        this.workerPool.isAvailable
      ) {
        for (const needed of selection.neededPatches) {
          if (
            !this.geometryCache.has(needed.id) &&
            !this.inFlightWorkerRequests.has(needed.id)
          ) {
            this.inFlightWorkerRequests.add(needed.id);
            this.workerPool
              .requestPatch({
                type: 'cylinder',
                id: needed.id,
                body: this.body() ?? undefined,
                address: needed.address,
                resolution: needed.resolution,
                centerBodyFixedM: needed.centerM,
                radiusM,
                rootSectors,
                rootPatchLengthM,
              })
              .then((raw) => {
                this.inFlightWorkerRequests.delete(needed.id);
                if (raw) {
                  const geom = reconstructCdlodBufferGeometry(raw);
                  this.geometryCache.set(needed.id, geom);
                }
              })
              .catch(() => {
                this.inFlightWorkerRequests.delete(needed.id);
              });
          }
        }
      }

      this.reconcilePatches(
        selection.patches,
        sampler,
        radiusM,
        rootSectors,
        rootPatchLengthM,
      );
    } else {
      this.updateExistingPatchUniforms();
    }

    this.emitTelemetry(Math.abs(Math.hypot(camPosM[0], camPosM[1]) - radiusM));
  }

  private reconcilePatches(
    desiredPatches: readonly ICdlodCylinderPatch[],
    sampler: ISurfaceSampler,
    radiusM: number,
    rootSectors: number,
    rootPatchLengthM: number,
  ): void {
    const desiredKeys = new Set<string>();
    const isWire = this.wireframe();
    const doMorph = this.cdlodMorphing();
    const palette = this.activePalette();

    for (const patch of desiredPatches) {
      const key = patch.id;
      desiredKeys.add(key);

      let resident = this.residentMeshes.get(key);
      if (!resident) {
        let geom = this.geometryCache.get(key);
        if (!geom) {
          const res = generateCdlodCylinderPatchGeometry(
            sampler,
            patch.address,
            patch.resolution,
            radiusM,
            patch.centerM,
            rootSectors,
            rootPatchLengthM,
          );
          geom = res.geometry;
          this.geometryCache.set(key, geom);
        }

        const mat = createCdlodTerrainMaterial({
          wireframe: isWire,
          palette,
        });

        const mesh = new Mesh(geom, mat);
        mesh.position.set(patch.centerM[0], patch.centerM[1], patch.centerM[2]);
        mesh.frustumCulled = false;

        this.terrainGroup.add(mesh);
        resident = { id: key, mesh, geometry: geom, material: mat };
        this.residentMeshes.set(key, resident);
      }

      // Update shader uniforms
      const u = resident.material.uniforms as unknown as ICdlodShaderUniforms;
      if (u.uMorphFactor) u.uMorphFactor.value = patch.morphFactor;
      if (u.uEnableMorph) u.uEnableMorph.value = doMorph ? 1.0 : 0.0;
      if (u.uEdgeMorph) {
        u.uEdgeMorph.value.set(
          patch.edgeMorph.left,
          patch.edgeMorph.right,
          patch.edgeMorph.bottom,
          patch.edgeMorph.top,
        );
      }
      if (u.uWireframeMode) u.uWireframeMode.value = isWire ? 1.0 : 0.0;
    }

    // Prune stale resident meshes
    for (const [key, resident] of this.residentMeshes.entries()) {
      if (!desiredKeys.has(key)) {
        this.terrainGroup.remove(resident.mesh);
        resident.material.dispose();
        this.residentMeshes.delete(key);
      }
    }
  }

  private updateExistingPatchUniforms(): void {
    const isWire = this.wireframe();
    for (const resident of this.residentMeshes.values()) {
      const u = resident.material.uniforms as unknown as ICdlodShaderUniforms;
      if (u.uWireframeMode) u.uWireframeMode.value = isWire ? 1.0 : 0.0;
    }
  }

  private emitTelemetry(altitudeM: number): void {
    let totalTriangles = 0;
    let highDetailCount = 0;
    let coarseCount = 0;

    for (const resident of this.residentMeshes.values()) {
      const indexAttr = resident.geometry.index;
      if (indexAttr) totalTriangles += indexAttr.count / 3;
      const parts = resident.id.split(':');
      const level = parseInt(parts[1] ?? '0', 10);
      if (level >= 3) highDetailCount++;
      else coarseCount++;
    }

    this.telemetry.emit({
      activeTriangles: totalTriangles,
      activePatches: this.residentMeshes.size,
      drawCalls: this.residentMeshes.size,
      cameraAltitudeM: altitudeM,
      highDetailCount,
      coarseCount,
      fps: 60,
    });
  }

  ngOnDestroy(): void {
    if (this.workerPool) {
      this.workerPool.terminate();
      this.workerPool = null;
    }

    this.clearCachesAndMeshes();

    const scene = this.engineService.scene;
    if (scene) {
      scene.remove(this.rootGroup);
    }
  }
}
