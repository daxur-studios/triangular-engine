import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  OnDestroy,
  output,
  untracked,
} from '@angular/core';
import {
  Mesh,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';
import {
  findCellAt,
  IPlanetGraphCore,
  IPlanetSurfaceSampler,
  IVec3,
  normalize,
} from 'triangular-engine/worldgen';
import {
  MAP_PROJECTIONS,
  MapProjectionKind,
} from '../map-projections';
import {
  buildOceanMorphGeometry,
  buildPlanetMorphGeometry,
  evaluateSurfaceTransform,
  IPlanetMorphGeometryData,
  IProjectionBasis,
  ISurfaceTransform,
} from '../planet-morph-geometry';
import {
  createPlanetMorphMaterial,
  IDynamicProjectionUniforms,
} from '../planet-morph-material';

export type ProjectionTrackingMode = 'none' | 'meridian' | 'oblique';

/**
 * High-level Angular / Three.js component that renders a seamless 3D Globe <-> 2.5D Flat Map
 * with real-time GPU reprojection, dynamic unit tracking (meridian or transverse polar),
 * bathymetric relief, ocean rendering, and cell picking.
 */
@Component({
  selector: 'cellPlanetMorphView',
  imports: [],
  template: '<ng-content></ng-content>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideObject3DComponent(CellPlanetMorphViewComponent)],
})
export class CellPlanetMorphViewComponent extends GroupComponent implements OnDestroy {
  private readonly raycaster = new Raycaster();

  // ==========================================================================
  // Inputs
  // ==========================================================================
  readonly sampler = input.required<IPlanetSurfaceSampler>();
  readonly graph = input<IPlanetGraphCore | null>(null);

  /** 0 = 3D globe, 1 = 2.5D flat map, or intermediate transition value */
  readonly morphProgress = input<number>(0);

  /** Equal Earth or Equirectangular */
  readonly projectionKind = input<MapProjectionKind>('equalEarth');

  /** Projection tracking mode: 'none' | 'meridian' | 'oblique' */
  readonly trackingMode = input<ProjectionTrackingMode>('none');

  /** Direction vector on the sphere to center the projection on */
  readonly trackingDirection = input<IVec3 | null>(null);

  readonly radius = input<number>(2.0);
  readonly heightScale = input<number>(0.16);
  readonly seabedRelief = input<boolean>(true);
  readonly showOcean = input<boolean>(true);
  readonly oceanSubstance = input<'water' | 'lava'>('water');
  readonly seaLevelElevation = input<number>(0);

  readonly longitudeSegments = input<number>(128);
  readonly latitudeRings = input<number>(64);

  readonly resolveColor = input<((direction: IVec3, elevation: number, isLand: boolean) => [number, number, number]) | undefined>(undefined);

  // ==========================================================================
  // Outputs
  // ==========================================================================
  readonly cellClick = output<{ cellId: number; direction: IVec3; point: Vector3 }>();
  readonly cellHover = output<{ cellId: number | null; direction: IVec3 | null }>();

  // ==========================================================================
  // Internal State
  // ==========================================================================
  private terrainGeometryData?: IPlanetMorphGeometryData;
  private oceanGeometryData?: IPlanetMorphGeometryData;
  private terrainMesh?: Mesh;
  private oceanMesh?: Mesh;

  private readonly dynamicUniforms: IDynamicProjectionUniforms = {
    uMorph: { value: 0 },
    uProjForward: { value: new Vector3(0, 0, 1) },
    uProjUp: { value: new Vector3(0, 1, 0) },
    uProjRight: { value: new Vector3(1, 0, 0) },
    uProjMode: { value: 0 },
    uMapWidth: { value: 12.56637 },
    uMapHeight: { value: 6.28318 },
    uRadius: { value: 2.0 },
    uProjectionType: { value: 1 },
  };

  constructor() {
    super();

    // Rebuild geometry when structural generation inputs change
    effect(() => {
      this.sampler();
      this.radius();
      this.heightScale();
      this.seabedRelief();
      this.seaLevelElevation();
      this.projectionKind();
      this.longitudeSegments();
      this.latitudeRings();
      this.resolveColor();
      this.oceanSubstance();

      untracked(() => {
        this.rebuildMeshes();
      });
    });

    // Update GPU uniforms when dynamic view/projection/tracking inputs change
    effect(() => {
      const morph = this.morphProgress();
      const projectionKind = this.projectionKind();
      this.trackingMode();
      this.trackingDirection();
      const showOcean = this.showOcean();

      untracked(() => {
        this.dynamicUniforms.uMorph.value = Math.max(0, Math.min(1, morph));
        this.dynamicUniforms.uProjectionType.value = projectionKind === 'equirectangular' ? 0 : 1;

        if (this.oceanMesh) {
          this.oceanMesh.visible = showOcean;
        }

        const activeBasis = this.computeActiveBasis();
        if (activeBasis) {
          this.dynamicUniforms.uProjMode.value = 1;
          this.dynamicUniforms.uProjForward.value.set(activeBasis.forward.x, activeBasis.forward.y, activeBasis.forward.z);
          this.dynamicUniforms.uProjUp.value.set(activeBasis.up.x, activeBasis.up.y, activeBasis.up.z);
          this.dynamicUniforms.uProjRight.value.set(activeBasis.right.x, activeBasis.right.y, activeBasis.right.z);
        } else {
          this.dynamicUniforms.uProjMode.value = 0;
        }
      });
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.disposeMeshes();
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  private cachedBasis?: IProjectionBasis;

  /**
   * Evaluates the exact 3D world position and surface normal for any unit/marker on the planet
   * matching the current morph state, active projection, and dynamic tracking basis.
   */
  evaluateUnitTransform(direction: IVec3, elevation = 0): ISurfaceTransform {
    const projection = MAP_PROJECTIONS[this.projectionKind()];
    const mapWidth = this.terrainGeometryData?.mapWidth ?? 2 * Math.PI * this.radius();
    const mapHeight = this.terrainGeometryData?.mapHeight ?? Math.PI * this.radius();
    const basis = this.cachedBasis ?? this.computeActiveBasis();

    return evaluateSurfaceTransform(
      direction,
      elevation,
      this.radius(),
      this.heightScale(),
      projection,
      mapWidth,
      mapHeight,
      this.morphProgress(),
      basis,
    );
  }

  /**
   * Synchronously updates the dynamic projection tracking frame every frame (for smooth
   * 60 FPS real-time moving aircraft/units without depending on Angular zone microtasks).
   */
  updateTracking(direction: IVec3 | null, mode?: ProjectionTrackingMode): void {
    const activeMode = mode ?? this.trackingMode();
    if (activeMode === 'none' || !direction) {
      this.cachedBasis = undefined;
      this.dynamicUniforms.uProjMode.value = 0;
      return;
    }

    const basis = this.computeBasisFor(activeMode, direction);
    this.cachedBasis = basis;
    this.dynamicUniforms.uProjMode.value = 1;
    this.dynamicUniforms.uProjForward.value.set(basis.forward.x, basis.forward.y, basis.forward.z);
    this.dynamicUniforms.uProjUp.value.set(basis.up.x, basis.up.y, basis.up.z);
    this.dynamicUniforms.uProjRight.value.set(basis.right.x, basis.right.y, basis.right.z);
  }

  /**
   * Computes the current orthonormal projection basis based on tracking mode and direction.
   */
  computeActiveBasis(): IProjectionBasis | undefined {
    if (this.cachedBasis) return this.cachedBasis;
    const mode = this.trackingMode();
    const dir = this.trackingDirection();
    if (mode === 'none' || !dir) {
      return undefined;
    }
    return this.computeBasisFor(mode, dir);
  }

  computeBasisFor(mode: ProjectionTrackingMode, dir: IVec3): IProjectionBasis {
    if (mode === 'meridian') {
      const normDir = normalize(dir);
      const lon = Math.atan2(normDir.x, normDir.z);
      const forward: IVec3 = { x: Math.sin(lon), y: 0, z: Math.cos(lon) };
      const up: IVec3 = { x: 0, y: 1, z: 0 };
      const right: IVec3 = { x: Math.cos(lon), y: 0, z: -Math.sin(lon) };
      return { forward, up, right };
    }

    // Full Oblique / Transverse: direction becomes forward axis
    const forward = normalize(dir);
    const worldUp: IVec3 = forward.y > 0.999
      ? { x: 0, y: 0, z: -1 }
      : forward.y < -0.999
        ? { x: 0, y: 0, z: 1 }
        : { x: 0, y: 1, z: 0 };
    const dot = worldUp.x * forward.x + worldUp.y * forward.y + worldUp.z * forward.z;
    const tanUp = {
      x: worldUp.x - dot * forward.x,
      y: worldUp.y - dot * forward.y,
      z: worldUp.z - dot * forward.z,
    };
    const up = normalize(tanUp);
    const right: IVec3 = {
      x: up.y * forward.z - up.z * forward.y,
      y: up.z * forward.x - up.x * forward.z,
      z: up.x * forward.y - up.y * forward.x,
    };
    return { forward, up, right };
  }

  /**
   * Raycasts the terrain mesh at screen coordinates and resolves the corresponding
   * spherical direction and cell id (if `graph` is provided).
   */
  resolveCellAtScreen(
    clientX: number,
    clientY: number,
    viewportEl: HTMLElement,
  ): { cellId: number; direction: IVec3; point: Vector3 } | null {
    if (!this.terrainMesh) return null;
    const rect = viewportEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const camera = this.engineService.camera;
    if (!camera) return null;

    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh);
    if (hits.length === 0 || !hits[0].uv) return null;

    const uv = hits[0].uv;
    const lon = -Math.PI + uv.x * 2 * Math.PI;
    const lat = -Math.PI / 2 + uv.y * Math.PI;
    const cosLat = Math.cos(lat);
    const direction: IVec3 = {
      x: cosLat * Math.sin(lon),
      y: Math.sin(lat),
      z: cosLat * Math.cos(lon),
    };

    const graph = this.graph();
    const cellId = graph ? findCellAt(graph, direction).id : -1;
    return { cellId, direction, point: hits[0].point };
  }

  onClick(event: MouseEvent, viewportEl: HTMLElement): void {
    const hit = this.resolveCellAtScreen(event.clientX, event.clientY, viewportEl);
    if (hit) {
      this.cellClick.emit(hit);
    }
  }

  onPointerMove(event: PointerEvent | MouseEvent, viewportEl: HTMLElement): void {
    const hit = this.resolveCellAtScreen(event.clientX, event.clientY, viewportEl);
    if (hit) {
      this.cellHover.emit({ cellId: hit.cellId, direction: hit.direction });
    } else {
      this.cellHover.emit({ cellId: null, direction: null });
    }
  }

  // ==========================================================================
  // Mesh Management
  // ==========================================================================

  private rebuildMeshes(): void {
    this.disposeMeshes();

    const radius = this.radius();
    const heightScale = this.heightScale();
    const projectionKind = this.projectionKind();
    const oceanSubstance = this.oceanSubstance();

    this.terrainGeometryData = buildPlanetMorphGeometry({
      sampler: this.sampler(),
      radius,
      heightScale,
      longitudeSegments: this.longitudeSegments(),
      latitudeRings: this.latitudeRings(),
      projectionKind,
      seabedRelief: this.seabedRelief(),
      seaLevelElevation: this.seaLevelElevation(),
      resolveColor: this.resolveColor(),
    });

    this.dynamicUniforms.uMapWidth.value = this.terrainGeometryData.mapWidth;
    this.dynamicUniforms.uMapHeight.value = this.terrainGeometryData.mapHeight;
    this.dynamicUniforms.uRadius.value = radius;
    this.dynamicUniforms.uProjectionType.value = projectionKind === 'equirectangular' ? 0 : 1;
    this.dynamicUniforms.uMorph.value = Math.max(0, Math.min(1, this.morphProgress()));

    const { material: terrainMat } = createPlanetMorphMaterial(
      { vertexColors: true, roughness: 0.9, metalness: 0.05 },
      this.dynamicUniforms,
    );
    this.terrainMesh = new Mesh(this.terrainGeometryData.geometry, terrainMat);
    this.terrainMesh.name = 'morph-terrain';
    this.object3D().add(this.terrainMesh);

    // Ocean shell
    this.oceanGeometryData = buildOceanMorphGeometry(
      radius,
      heightScale,
      this.seaLevelElevation(),
      projectionKind,
      this.longitudeSegments(),
      this.latitudeRings(),
    );
    const { material: oceanMat } = createPlanetMorphMaterial(
      {
        color: oceanSubstance === 'lava' ? '#e04010' : '#146299',
        transparent: true,
        opacity: 0.68,
        roughness: 0.12,
        metalness: 0.1,
        depthWrite: false,
      },
      this.dynamicUniforms,
    );
    this.oceanMesh = new Mesh(this.oceanGeometryData.geometry, oceanMat);
    this.oceanMesh.name = 'morph-ocean';
    this.oceanMesh.visible = this.showOcean();
    this.object3D().add(this.oceanMesh);
  }

  private disposeMeshes(): void {
    if (this.terrainMesh) {
      this.object3D().remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      if (Array.isArray(this.terrainMesh.material)) {
        this.terrainMesh.material.forEach((m) => m.dispose());
      } else {
        this.terrainMesh.material.dispose();
      }
      this.terrainMesh = undefined;
    }
    if (this.oceanMesh) {
      this.object3D().remove(this.oceanMesh);
      this.oceanMesh.geometry.dispose();
      if (Array.isArray(this.oceanMesh.material)) {
        this.oceanMesh.material.forEach((m) => m.dispose());
      } else {
        this.oceanMesh.material.dispose();
      }
      this.oceanMesh = undefined;
    }
    this.terrainGeometryData = undefined;
    this.oceanGeometryData = undefined;
  }
}
