import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';
import {
  classifyCellBorders,
  extractCellBorders,
  findCellAt,
  IPlanetGraphCore,
  IPlanetSurfaceSampler,
  IVec3,
  normalize,
} from 'triangular-engine/worldgen';
import {
  buildCellBorderLineGeometry,
  buildCellOverlayGeometry,
  buildTerritoryRibbonGeometry,
} from '../cell-border-geometry';
import { CellTacticalOverlay } from '../cell-tactical-overlay';
import { MAP_PROJECTIONS, MapProjectionKind } from '../map-projections';
import {
  buildOceanMorphGeometry,
  buildPlanetMorphGeometry,
  evaluateSurfaceTransform,
  IPlanetMorphGeometryData,
  ISurfaceTransform,
} from '../planet-morph-geometry';
import {
  buildPlanetMorphBorderGeometry,
  evaluateLeftBorderTrack,
  evaluateTopBorderTrack,
  IPlanetMorphBorderGeometryData,
} from '../planet-morph-border-geometry';
import { IProjectionBasis } from '../antimeridian-seam';
import {
  computeSunDirectionFromTime,
  createDefaultPlanetDayNightUniforms,
  createPlanetBorderMorphMaterial,
  createPlanetCellOverlayMaterial,
  createPlanetMapBorderMaterial,
  createPlanetMorphMaterial,
  enablePlanetDayNightLighting,
  enablePlanetMorphProjection,
  IDynamicProjectionUniforms,
  IPlanetDayNightUniforms,
  PlanetMapBorderStyle,
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
export class CellPlanetMorphViewComponent
  extends GroupComponent
  implements OnDestroy
{
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

  readonly resolveColor = input<
    | ((
        direction: IVec3,
        elevation: number,
        isLand: boolean,
      ) => [number, number, number])
    | undefined
  >(undefined);

  // Border & Tactical Overlay inputs
  readonly showCellBorders = input<boolean>(false);
  readonly cellBorderColor = input<string>('#38bdf8');
  readonly cellBorderOpacity = input<number>(0.4);
  readonly showTerritoryBorders = input<boolean>(false);
  readonly territoryBorderColor = input<string>('#facc15');
  readonly territoryBorderWidth = input<number>(0.015);
  readonly factionByCell = input<ArrayLike<number> | null | undefined>(null);
  readonly factionColors = input<Record<number, string> | null | undefined>(
    null,
  );
  readonly showTacticalOverlay = input<boolean>(false);
  readonly clampBordersToSeaLevel = input<boolean>(true);
  readonly adaptiveReliefSubdivision = input<boolean>(true);
  readonly reliefThreshold = input<number>(0.008);

  // Map Frame / Perimeter Border inputs
  readonly showMapBorder = input<boolean>(false);
  readonly mapBorderStyle = input<PlanetMapBorderStyle>('cartographic');
  readonly mapBorderColor = input<string>('#38bdf8');
  readonly mapBorderOpacity = input<number>(0.85);
  readonly mapBorderWidth = input<number>(0.07);
  readonly mapBorderFadeStart = input<number>(0.60);
  readonly mapBorderFadeEnd = input<number>(0.40);
  readonly mapBorderClearance = input<number>(0.04);
  readonly showBorderSliders = input<boolean>(true);
  readonly projectionCenterLon = input<number>(0);
  readonly projectionCenterLat = input<number>(0);
  readonly borderSliderColor = input<string>('#f59e0b');

  // Custom Material inputs (allowing consumers to provide their own materials)
  readonly customTerrainMaterial = input<
    | Material
    | ((
        uniforms: IDynamicProjectionUniforms,
        dayNightUniforms: IPlanetDayNightUniforms,
      ) => Material)
    | null
  >(null);
  readonly customOceanMaterial = input<
    | Material
    | ((
        uniforms: IDynamicProjectionUniforms,
        dayNightUniforms: IPlanetDayNightUniforms,
      ) => Material)
    | null
  >(null);

  // Day / Night Cycle inputs
  readonly dayNightEnabled = input<boolean>(false);
  readonly sunDirection = input<IVec3 | Vector3 | null>(null);
  readonly timeOfDay = input<number | null>(null); // hours [0..24), e.g. 12 = noon
  readonly axialTiltDeg = input<number>(23.44);
  readonly seasonPhase = input<number>(0.25); // 0.25 = equinox, 0.5 = summer solstice
  readonly nightAmbient = input<number>(0.2);
  readonly twilightWidth = input<number>(0.12);
  readonly sunsetGlow = input<number>(0.5);
  readonly nightColor = input<string | Vector3>('#18243e');

  // ==========================================================================
  // Outputs
  // ==========================================================================
  readonly cellClick = output<{
    cellId: number;
    direction: IVec3;
    point: Vector3;
  }>();
  readonly cellHover = output<{
    cellId: number | null;
    direction: IVec3 | null;
  }>();
  readonly projectionCenterChange = output<{
    lonDeg: number;
    latDeg: number;
  }>();

  // ==========================================================================
  // Internal State & Public Tactical Handle
  // ==========================================================================
  readonly tacticalOverlay = signal<CellTacticalOverlay | null>(null);
  readonly effectiveSunDirection = signal<Vector3>(new Vector3(0, 0, 1));

  private terrainGeometryData?: IPlanetMorphGeometryData;
  private oceanGeometryData?: IPlanetMorphGeometryData;
  private terrainMesh?: Mesh;
  private oceanMesh?: Mesh;

  private cellBorderGeometry?: BufferGeometry;
  private cellBorderMesh?: LineSegments;
  private territoryRibbonGeometry?: BufferGeometry;
  private territoryRibbonMesh?: Mesh;
  private cellOverlayGeometry?: BufferGeometry;
  private cellOverlayMesh?: Mesh;

  private mapBorderGeometryData?: IPlanetMorphBorderGeometryData;
  private mapBorderMesh?: Mesh;
  private topSliderKnobMesh?: Mesh;
  private leftSliderKnobMesh?: Mesh;
  private isDraggingSlider: 'top' | 'left' | null = null;

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

  private readonly dayNightUniforms: IPlanetDayNightUniforms =
    createDefaultPlanetDayNightUniforms();

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
      this.customTerrainMaterial();
      this.customOceanMaterial();

      untracked(() => {
        this.rebuildMeshes();
      });
    });

    // Update Day/Night GPU uniforms when solar parameters change
    effect(() => {
      const enabled = this.dayNightEnabled();
      const explicitDir = this.sunDirection();
      const time = this.timeOfDay();
      const tilt = this.axialTiltDeg();
      const season = this.seasonPhase();
      const ambient = this.nightAmbient();
      const twilight = this.twilightWidth();
      const glow = this.sunsetGlow();
      const nc = this.nightColor();

      untracked(() => {
        let sunDir: Vector3;
        if (explicitDir) {
          sunDir =
            explicitDir instanceof Vector3
              ? explicitDir.clone().normalize()
              : new Vector3(
                  explicitDir.x,
                  explicitDir.y,
                  explicitDir.z,
                ).normalize();
        } else if (time !== null && time !== undefined) {
          sunDir = computeSunDirectionFromTime(time, tilt, season);
        } else {
          sunDir = new Vector3(0, 0, 1);
        }

        this.effectiveSunDirection.set(sunDir);
        this.dayNightUniforms.uDayNightEnabled.value = enabled ? 1 : 0;
        this.dayNightUniforms.uSunDirection.value.copy(sunDir);
        this.dayNightUniforms.uNightAmbient.value = ambient;
        this.dayNightUniforms.uTwilightWidth.value = twilight;
        this.dayNightUniforms.uSunsetGlow.value = glow;

        if (nc instanceof Vector3) {
          this.dayNightUniforms.uNightColor.value.copy(nc);
        } else {
          const c = new Color(nc);
          this.dayNightUniforms.uNightColor.value.set(c.r, c.g, c.b);
        }
      });
    });

    // Update GPU uniforms when dynamic view/projection/tracking inputs change
    effect(() => {
      const morph = this.morphProgress();
      const projectionKind = this.projectionKind();
      this.trackingMode();
      this.trackingDirection();
      this.projectionCenterLon();
      this.projectionCenterLat();
      this.seaLevelElevation();
      this.heightScale();
      this.mapBorderClearance();
      const showOcean = this.showOcean();

      untracked(() => {
        this.dynamicUniforms.uMorph.value = Math.max(0, Math.min(1, morph));
        this.dynamicUniforms.uProjectionType.value =
          projectionKind === 'equirectangular' ? 0 : 1;

        if (this.oceanMesh) {
          this.oceanMesh.visible = showOcean;
        }

        const activeBasis = this.computeActiveBasis();
        if (activeBasis) {
          this.dynamicUniforms.uProjMode.value = 1;
          this.dynamicUniforms.uProjForward.value.set(
            activeBasis.forward.x,
            activeBasis.forward.y,
            activeBasis.forward.z,
          );
          this.dynamicUniforms.uProjUp.value.set(
            activeBasis.up.x,
            activeBasis.up.y,
            activeBasis.up.z,
          );
          this.dynamicUniforms.uProjRight.value.set(
            activeBasis.right.x,
            activeBasis.right.y,
            activeBasis.right.z,
          );
        } else {
          this.dynamicUniforms.uProjMode.value = 0;
        }

        this.updateSliderKnobsPositions();
      });
    });

    // Rebuild or update borders and tactical overlay when their inputs change
    effect(() => {
      this.graph();
      this.sampler();
      this.radius();
      this.heightScale();
      this.projectionKind();
      this.showCellBorders();
      this.cellBorderColor();
      this.cellBorderOpacity();
      this.showTerritoryBorders();
      this.territoryBorderColor();
      this.territoryBorderWidth();
      this.factionByCell();
      this.factionColors();
      this.showTacticalOverlay();
      this.clampBordersToSeaLevel();
      this.adaptiveReliefSubdivision();
      this.reliefThreshold();

      untracked(() => {
        this.rebuildOverlayMeshes();
      });
    });

    // Rebuild map border when its parameters change
    effect(() => {
      this.showMapBorder();
      this.mapBorderStyle();
      this.mapBorderColor();
      this.mapBorderOpacity();
      this.mapBorderWidth();
      this.mapBorderFadeStart();
      this.mapBorderFadeEnd();
      this.mapBorderClearance();
      this.seaLevelElevation();
      this.heightScale();
      this.showBorderSliders();
      this.borderSliderColor();
      this.radius();
      this.projectionKind();
      this.longitudeSegments();
      this.latitudeRings();

      untracked(() => {
        this.rebuildMapBorderMesh();
      });
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.disposeMeshes();
    this.tacticalOverlay()?.dispose();
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  private cachedBasis?: IProjectionBasis;
  private pickSyncKey = '';

  /**
   * CPU-side morph of the terrain `position` attribute for picking.
   *
   * The GPU morphs vertices in the vertex shader from `aSpherePos` to `aFlatPos` via `uMorph`,
   * so `terrainMesh.geometry.attributes.position` stays pinned at the sphere while the rendered
   * surface unrolls. A raycast against it therefore only matches the globe: in flat view the
   * center is approximately right (small divergence) and the map edges miss entirely.
   *
   * This rewrites `position` to the exact morphed surface before picking, using the same basis
   * (tracking) the shader uses. Cheap enough to run per pick at interactive rates.
   */
  private syncPickGeometry(): void {
    const geometry = this.terrainMesh?.geometry;
    const sphere = geometry?.getAttribute('aSpherePos') as
      | BufferAttribute
      | undefined;
    const sphereNorm = geometry?.getAttribute('aSphereNorm') as
      | BufferAttribute
      | undefined;
    const flat = geometry?.getAttribute('aFlatPos') as
      | BufferAttribute
      | undefined;
    const position = geometry?.getAttribute('position') as
      | BufferAttribute
      | undefined;
    if (!geometry || !sphere || !sphereNorm || !flat || !position) return;

    const morph = Math.max(0, Math.min(1, this.morphProgress()));
    const projection = MAP_PROJECTIONS[this.projectionKind()];
    const mapWidth =
      this.terrainGeometryData?.mapWidth ?? 2 * Math.PI * this.radius();
    const mapHeight =
      this.terrainGeometryData?.mapHeight ?? Math.PI * this.radius();
    const basis = this.cachedBasis ?? this.computeActiveBasis();

    // Cheap early-out: only rewrite the buffer when the morph frame actually changed.
    const key = `${morph}|${this.projectionKind()}|${this.radius()}|${mapWidth}|${mapHeight}|${
      basis
        ? `${basis.forward.x},${basis.forward.y},${basis.forward.z},${basis.up.x},${basis.up.y},${basis.up.z},${basis.right.x},${basis.right.y},${basis.right.z}`
        : 'none'
    }`;
    if (key === this.pickSyncKey) return;
    this.pickSyncKey = key;

    const sphereArray = sphere.array as Float32Array;
    const sphereNormArray = sphereNorm.array as Float32Array;
    const flatArray = flat.array as Float32Array;
    const positionArray = position.array as Float32Array;

    for (let i = 0; i < positionArray.length; i += 3) {
      const sx = sphereArray[i];
      const sy = sphereArray[i + 1];
      const sz = sphereArray[i + 2];
      const fx = flatArray[i];
      const fy = flatArray[i + 1];
      const fz = flatArray[i + 2];

      let flatX = fx;
      let flatY = fy;

      if (basis) {
        // Mirror the shader's dynamic-basis reprojection: re-derive lon/lat in the tracking
        // frame, then re-project so picking agrees with a recentered map.
        const nx = sphereNormArray[i];
        const ny = sphereNormArray[i + 1];
        const nz = sphereNormArray[i + 2];
        const dotFwd =
          nx * basis.forward.x + ny * basis.forward.y + nz * basis.forward.z;
        const dotRight =
          nx * basis.right.x + ny * basis.right.y + nz * basis.right.z;
        const dotUp = nx * basis.up.x + ny * basis.up.y + nz * basis.up.z;
        const pLon = Math.atan2(dotRight, dotFwd);
        const pLat = Math.asin(Math.max(-1, Math.min(1, dotUp)));
        const proj = projection.project(pLon, pLat, mapWidth, mapHeight);
        flatX = (proj.x / mapWidth - 0.5) * mapWidth;
        flatY = -(proj.y / mapHeight - 0.5) * mapHeight;
      }

      positionArray[i] = sx + (flatX - sx) * morph;
      positionArray[i + 1] = sy + (flatY - sy) * morph;
      positionArray[i + 2] = sz + (fz - sz) * morph;
    }

    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  /**
   * Evaluates the exact 3D world position and surface normal for any unit/marker on the planet
   * matching the current morph state, active projection, and dynamic tracking basis.
   */
  evaluateUnitTransform(direction: IVec3, elevation = 0): ISurfaceTransform {
    const projection = MAP_PROJECTIONS[this.projectionKind()];
    const mapWidth =
      this.terrainGeometryData?.mapWidth ?? 2 * Math.PI * this.radius();
    const mapHeight =
      this.terrainGeometryData?.mapHeight ?? Math.PI * this.radius();
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
    this.dynamicUniforms.uProjForward.value.set(
      basis.forward.x,
      basis.forward.y,
      basis.forward.z,
    );
    this.dynamicUniforms.uProjUp.value.set(basis.up.x, basis.up.y, basis.up.z);
    this.dynamicUniforms.uProjRight.value.set(
      basis.right.x,
      basis.right.y,
      basis.right.z,
    );
  }

  /**
   * Computes the current orthonormal projection basis based on tracking mode and direction.
   */
  computeActiveBasis(): IProjectionBasis | undefined {
    if (this.cachedBasis) return this.cachedBasis;
    const mode = this.trackingMode();
    const dir = this.trackingDirection();
    if (mode !== 'none' && dir) {
      return this.computeBasisFor(mode, dir);
    }
    const lonDeg = this.projectionCenterLon();
    const latDeg = this.projectionCenterLat();
    if (Math.abs(lonDeg) > 0.001 || Math.abs(latDeg) > 0.001) {
      return this.computeManualBasis(lonDeg, latDeg);
    }
    return undefined;
  }

  computeManualBasis(lonDeg: number, latDeg: number): IProjectionBasis {
    const lonRad = (lonDeg * Math.PI) / 180;
    const latRad = (latDeg * Math.PI) / 180;

    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    const forward: IVec3 = {
      x: cosLat * Math.sin(lonRad),
      y: sinLat,
      z: cosLat * Math.cos(lonRad),
    };

    if (Math.abs(latDeg) < 0.001) {
      const up: IVec3 = { x: 0, y: 1, z: 0 };
      const right: IVec3 = { x: Math.cos(lonRad), y: 0, z: -Math.sin(lonRad) };
      return { forward, up, right };
    }

    const worldUp: IVec3 =
      forward.y > 0.999
        ? { x: 0, y: 0, z: -1 }
        : forward.y < -0.999
          ? { x: 0, y: 0, z: 1 }
          : { x: 0, y: 1, z: 0 };
    const dot =
      worldUp.x * forward.x + worldUp.y * forward.y + worldUp.z * forward.z;
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
    const worldUp: IVec3 =
      forward.y > 0.999
        ? { x: 0, y: 0, z: -1 }
        : forward.y < -0.999
          ? { x: 0, y: 0, z: 1 }
          : { x: 0, y: 1, z: 0 };
    const dot =
      worldUp.x * forward.x + worldUp.y * forward.y + worldUp.z * forward.z;
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

    this.syncPickGeometry();

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

  get isDragging(): boolean {
    return this.isDraggingSlider !== null;
  }

  onPointerDown(
    event: PointerEvent | MouseEvent,
    viewportEl: HTMLElement,
  ): boolean {
    if (
      !this.showMapBorder() ||
      !this.showBorderSliders() ||
      this.morphProgress() < 0.4
    ) {
      return false;
    }
    const rect = viewportEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const camera = this.engineService.camera;
    if (!camera) return false;

    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, camera);

    // 1. Check direct knob hits
    const knobCandidates: Mesh[] = [];
    if (this.topSliderKnobMesh) knobCandidates.push(this.topSliderKnobMesh);
    if (this.leftSliderKnobMesh) knobCandidates.push(this.leftSliderKnobMesh);

    if (knobCandidates.length > 0) {
      const hits = this.raycaster.intersectObjects(knobCandidates);
      if (hits.length > 0) {
        if (hits[0].object === this.topSliderKnobMesh) {
          this.isDraggingSlider = 'top';
          return true;
        } else if (hits[0].object === this.leftSliderKnobMesh) {
          this.isDraggingSlider = 'left';
          return true;
        }
      }
    }

    // 2. Check track (border mesh) hits
    if (this.mapBorderMesh) {
      const borderHits = this.raycaster.intersectObject(this.mapBorderMesh);
      if (borderHits.length > 0 && borderHits[0].uv) {
        const u = borderHits[0].uv.x;
        const lonSegs = this.longitudeSegments();
        const latRings = this.latitudeRings();
        const loopCount = 2 * lonSegs + 2 * latRings;
        const topFracEnd = lonSegs / loopCount;
        const leftFracStart = (2 * lonSegs + latRings) / loopCount;

        if (u <= topFracEnd) {
          const frac = u / topFracEnd;
          const lonDeg = Math.round((frac * 2 - 1) * 180);
          this.isDraggingSlider = 'top';
          this.projectionCenterChange.emit({
            lonDeg,
            latDeg: this.projectionCenterLat(),
          });
          return true;
        } else if (u >= leftFracStart) {
          const frac = (u - leftFracStart) / (1 - leftFracStart);
          const latDeg = Math.round((frac * 2 - 1) * 90);
          this.isDraggingSlider = 'left';
          this.projectionCenterChange.emit({
            lonDeg: this.projectionCenterLon(),
            latDeg,
          });
          return true;
        }
      }
    }

    return false;
  }

  onPointerDrag(
    event: PointerEvent | MouseEvent,
    viewportEl: HTMLElement,
  ): boolean {
    if (!this.isDraggingSlider) return false;

    const rect = viewportEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const camera = this.engineService.camera;
    if (!camera) return false;

    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, camera);

    const radius = this.radius();
    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;

    const planeNormal = new Vector3(0, 0, 1).applyQuaternion(
      this.object3D().quaternion,
    );
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      this.object3D().position,
    );
    const hitPoint = new Vector3();

    if (this.raycaster.ray.intersectPlane(plane, hitPoint)) {
      const localHit = this.object3D().worldToLocal(hitPoint);

      if (this.isDraggingSlider === 'top') {
        const halfWidth = mapWidth / 2;
        const normX = Math.max(-1, Math.min(1, localHit.x / halfWidth));
        const lonDeg = Math.round(normX * 180);
        this.projectionCenterChange.emit({
          lonDeg,
          latDeg: this.projectionCenterLat(),
        });
        return true;
      } else if (this.isDraggingSlider === 'left') {
        const halfHeight = mapHeight / 2;
        const normY = Math.max(-1, Math.min(1, localHit.y / halfHeight));
        const latDeg = Math.round(normY * 90);
        this.projectionCenterChange.emit({
          lonDeg: this.projectionCenterLon(),
          latDeg,
        });
        return true;
      }
    }
    return false;
  }

  onPointerUp(): void {
    this.isDraggingSlider = null;
  }

  onClick(event: MouseEvent, viewportEl: HTMLElement): void {
    if (this.isDraggingSlider) {
      this.isDraggingSlider = null;
      return;
    }
    const hit = this.resolveCellAtScreen(
      event.clientX,
      event.clientY,
      viewportEl,
    );
    if (hit) {
      this.cellClick.emit(hit);
    }
  }

  onPointerMove(
    event: PointerEvent | MouseEvent,
    viewportEl: HTMLElement,
  ): void {
    if (this.isDraggingSlider) {
      this.onPointerDrag(event, viewportEl);
      return;
    }
    const hit = this.resolveCellAtScreen(
      event.clientX,
      event.clientY,
      viewportEl,
    );
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

    // New geometry means the cached pick buffer is stale; force the next pick to resync.
    this.pickSyncKey = '';

    this.dynamicUniforms.uMapWidth.value = this.terrainGeometryData.mapWidth;
    this.dynamicUniforms.uMapHeight.value = this.terrainGeometryData.mapHeight;
    this.dynamicUniforms.uRadius.value = radius;
    this.dynamicUniforms.uProjectionType.value =
      projectionKind === 'equirectangular' ? 0 : 1;
    this.dynamicUniforms.uMorph.value = Math.max(
      0,
      Math.min(1, this.morphProgress()),
    );

    // Terrain material
    let terrainMat: Material;
    const customTerrain = this.customTerrainMaterial();
    if (typeof customTerrain === 'function') {
      terrainMat = customTerrain(this.dynamicUniforms, this.dayNightUniforms);
    } else if (customTerrain instanceof Material) {
      terrainMat = customTerrain;
      enablePlanetMorphProjection(terrainMat, this.dynamicUniforms);
      enablePlanetDayNightLighting(terrainMat, this.dayNightUniforms);
    } else {
      const created = createPlanetMorphMaterial(
        { vertexColors: true, roughness: 0.9, metalness: 0.05 },
        this.dynamicUniforms,
        this.dayNightUniforms,
      );
      terrainMat = created.material;
    }
    this.terrainMesh = new Mesh(this.terrainGeometryData.geometry, terrainMat);
    this.terrainMesh.name = 'morph-terrain';
    this.terrainMesh.renderOrder = 0;
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
    let oceanMat: Material;
    const customOcean = this.customOceanMaterial();
    if (typeof customOcean === 'function') {
      oceanMat = customOcean(this.dynamicUniforms, this.dayNightUniforms);
    } else if (customOcean instanceof Material) {
      oceanMat = customOcean;
      enablePlanetMorphProjection(oceanMat, this.dynamicUniforms);
      enablePlanetDayNightLighting(oceanMat, this.dayNightUniforms);
    } else {
      const created = createPlanetMorphMaterial(
        {
          color: oceanSubstance === 'lava' ? '#e04010' : '#146299',
          transparent: true,
          opacity: 0.68,
          roughness: 0.12,
          metalness: 0.1,
          depthWrite: false,
        },
        this.dynamicUniforms,
        this.dayNightUniforms,
      );
      oceanMat = created.material;
    }
    this.oceanMesh = new Mesh(this.oceanGeometryData.geometry, oceanMat);
    this.oceanMesh.name = 'morph-ocean';
    this.oceanMesh.visible = this.showOcean();
    this.oceanMesh.renderOrder = 1;
    this.object3D().add(this.oceanMesh);

    // Overlay & border meshes
    this.rebuildOverlayMeshes();
  }

  private rebuildOverlayMeshes(): void {
    this.disposeOverlayMeshes();

    const graph = this.graph();
    if (!graph) return;

    const radius = this.radius();
    const heightScale = this.heightScale();
    const projectionKind = this.projectionKind();
    const sampler = this.sampler();
    const seabedRelief = this.seabedRelief();
    const seaLevelElevation = this.seaLevelElevation();
    const clampToSeaLevel = this.clampBordersToSeaLevel();
    const adaptiveReliefSubdivision = this.adaptiveReliefSubdivision();
    const reliefThreshold = this.reliefThreshold();

    // Ensure tactical overlay is initialized for this graph
    let overlay = this.tacticalOverlay();
    if (!overlay || overlay.cellCount !== graph.cells.length) {
      overlay = new CellTacticalOverlay(graph.cells.length);
      this.tacticalOverlay.set(overlay);
    }

    // 1. Cell borders (thin floating straight lines)
    if (this.showCellBorders()) {
      this.cellBorderGeometry = buildCellBorderLineGeometry({
        graph,
        sampler,
        radius,
        heightScale,
        projectionKind,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
        adaptiveReliefSubdivision,
        reliefThreshold,
      });
      const borderMat = createPlanetBorderMorphMaterial(this.dynamicUniforms, {
        color: this.cellBorderColor(),
        opacity: this.cellBorderOpacity(),
      });
      this.cellBorderMesh = new LineSegments(
        this.cellBorderGeometry,
        borderMat,
      );
      this.cellBorderMesh.name = 'morph-cell-borders';
      this.cellBorderMesh.renderOrder = 3;
      this.object3D().add(this.cellBorderMesh);
    }

    // 2. Territory borders (thick quads)
    if (this.showTerritoryBorders()) {
      const factions = this.factionByCell();
      const allEdges = extractCellBorders(graph);
      const territoryEdges = factions
        ? classifyCellBorders(allEdges, factions).territoryEdges
        : allEdges;

      this.territoryRibbonGeometry = buildTerritoryRibbonGeometry({
        edges: territoryEdges,
        sampler,
        radius,
        heightScale,
        ribbonWidth: this.territoryBorderWidth(),
        projectionKind,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
        adaptiveReliefSubdivision,
        reliefThreshold,
      });
      const ribbonMat = createPlanetBorderMorphMaterial(this.dynamicUniforms, {
        color: this.territoryBorderColor(),
        opacity: 0.9,
        ribbonWidth: this.territoryBorderWidth(),
      });
      this.territoryRibbonMesh = new Mesh(
        this.territoryRibbonGeometry,
        ribbonMat,
      );
      this.territoryRibbonMesh.name = 'morph-territory-ribbons';
      this.territoryRibbonMesh.renderOrder = 4;
      this.object3D().add(this.territoryRibbonMesh);
    }

    // 3. Tactical cell overlay
    if (this.showTacticalOverlay() && overlay) {
      this.cellOverlayGeometry = buildCellOverlayGeometry({
        graph,
        sampler,
        radius,
        heightScale,
        projectionKind,
        seabedRelief,
        seaLevelElevation,
        clampToSeaLevel,
        adaptiveReliefSubdivision,
      });
      const overlayMat = createPlanetCellOverlayMaterial(
        this.dynamicUniforms,
        { value: overlay.texture },
        overlay.texWidth,
        overlay.texHeight,
      );
      this.cellOverlayMesh = new Mesh(this.cellOverlayGeometry, overlayMat);
      this.cellOverlayMesh.name = 'morph-cell-overlay';
      this.cellOverlayMesh.renderOrder = 2;
      this.object3D().add(this.cellOverlayMesh);
    }
  }

  private disposeOverlayMeshes(): void {
    if (this.cellBorderMesh) {
      this.object3D().remove(this.cellBorderMesh);
      this.cellBorderGeometry?.dispose();
      if (Array.isArray(this.cellBorderMesh.material)) {
        this.cellBorderMesh.material.forEach((m) => m.dispose());
      } else {
        this.cellBorderMesh.material.dispose();
      }
      this.cellBorderMesh = undefined;
      this.cellBorderGeometry = undefined;
    }
    if (this.territoryRibbonMesh) {
      this.object3D().remove(this.territoryRibbonMesh);
      this.territoryRibbonGeometry?.dispose();
      if (Array.isArray(this.territoryRibbonMesh.material)) {
        this.territoryRibbonMesh.material.forEach((m) => m.dispose());
      } else {
        this.territoryRibbonMesh.material.dispose();
      }
      this.territoryRibbonMesh = undefined;
      this.territoryRibbonGeometry = undefined;
    }
    if (this.cellOverlayMesh) {
      this.object3D().remove(this.cellOverlayMesh);
      this.cellOverlayGeometry?.dispose();
      if (Array.isArray(this.cellOverlayMesh.material)) {
        this.cellOverlayMesh.material.forEach((m) => m.dispose());
      } else {
        this.cellOverlayMesh.material.dispose();
      }
      this.cellOverlayMesh = undefined;
      this.cellOverlayGeometry = undefined;
    }
  }

  private disposeMeshes(): void {
    this.disposeOverlayMeshes();
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
    this.disposeMapBorderMesh();
  }

  private rebuildMapBorderMesh(): void {
    this.disposeMapBorderMesh();
    if (!this.showMapBorder()) return;

    const radius = this.radius();
    const projectionKind = this.projectionKind();
    const borderWidth = this.mapBorderWidth();

    this.mapBorderGeometryData = buildPlanetMorphBorderGeometry({
      radius,
      borderWidth,
      projectionKind,
      longitudeSegments: this.longitudeSegments(),
      latitudeRings: this.latitudeRings(),
      seaLevelElevation: this.seaLevelElevation(),
      heightScale: this.heightScale(),
      clearance: this.mapBorderClearance(),
    });

    const borderMat = createPlanetMapBorderMaterial(this.dynamicUniforms, {
      color: this.mapBorderColor(),
      opacity: this.mapBorderOpacity(),
      borderStyle: this.mapBorderStyle(),
      fadeStart: this.mapBorderFadeStart(),
      fadeEnd: this.mapBorderFadeEnd(),
    });

    this.mapBorderMesh = new Mesh(
      this.mapBorderGeometryData.geometry,
      borderMat,
    );
    this.mapBorderMesh.name = 'morph-map-border';
    this.mapBorderMesh.renderOrder = 5;
    this.object3D().add(this.mapBorderMesh);

    if (this.showBorderSliders()) {
      const sliderColor = this.borderSliderColor();
      const knobMat = new MeshStandardMaterial({
        color: sliderColor,
        roughness: 0.25,
        metalness: 0.4,
        emissive: sliderColor,
        emissiveIntensity: 0.7,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -2.0,
      });

      // Top slider knob: Diamond pointer pointing towards the map
      const topGeo = new OctahedronGeometry(0.09);
      topGeo.scale(1.2, 0.7, 0.7);
      this.topSliderKnobMesh = new Mesh(topGeo, knobMat);
      this.topSliderKnobMesh.name = 'morph-border-top-knob';
      this.topSliderKnobMesh.renderOrder = 6;
      this.object3D().add(this.topSliderKnobMesh);

      // Left slider knob: Diamond pointer pointing right towards the map
      const leftGeo = new OctahedronGeometry(0.09);
      leftGeo.scale(0.7, 1.2, 0.7);
      this.leftSliderKnobMesh = new Mesh(leftGeo, knobMat.clone());
      this.leftSliderKnobMesh.name = 'morph-border-left-knob';
      this.leftSliderKnobMesh.renderOrder = 6;
      this.object3D().add(this.leftSliderKnobMesh);
    }

    this.updateSliderKnobsPositions();
  }

  private disposeMapBorderMesh(): void {
    if (this.topSliderKnobMesh) {
      this.object3D().remove(this.topSliderKnobMesh);
      this.topSliderKnobMesh.geometry.dispose();
      (this.topSliderKnobMesh.material as Material).dispose();
      this.topSliderKnobMesh = undefined;
    }
    if (this.leftSliderKnobMesh) {
      this.object3D().remove(this.leftSliderKnobMesh);
      this.leftSliderKnobMesh.geometry.dispose();
      (this.leftSliderKnobMesh.material as Material).dispose();
      this.leftSliderKnobMesh = undefined;
    }
    if (this.mapBorderMesh) {
      this.object3D().remove(this.mapBorderMesh);
      this.mapBorderMesh.geometry.dispose();
      if (Array.isArray(this.mapBorderMesh.material)) {
        this.mapBorderMesh.material.forEach((m) => m.dispose());
      } else {
        this.mapBorderMesh.material.dispose();
      }
      this.mapBorderMesh = undefined;
      this.mapBorderGeometryData = undefined;
    }
  }

  updateSliderKnobsPositions(): void {
    if (!this.topSliderKnobMesh || !this.leftSliderKnobMesh) return;

    const morph = this.morphProgress();
    if (morph < 0.40 || !this.showMapBorder() || !this.showBorderSliders()) {
      this.topSliderKnobMesh.visible = false;
      this.leftSliderKnobMesh.visible = false;
      return;
    }

    this.topSliderKnobMesh.visible = true;
    this.leftSliderKnobMesh.visible = true;

    const fade = Math.max(0, Math.min(1, (morph - 0.40) / 0.20));
    (this.topSliderKnobMesh.material as MeshStandardMaterial).opacity = 0.95 * fade;
    (this.leftSliderKnobMesh.material as MeshStandardMaterial).opacity = 0.95 * fade;

    const radius = this.radius();
    const projKind = this.projectionKind();
    const seaLevel = this.seaLevelElevation();
    const heightScale = this.heightScale();
    const knobClearance = this.mapBorderClearance() + 0.02;

    const lonRad = (this.projectionCenterLon() * Math.PI) / 180;
    const topTrans = evaluateTopBorderTrack(
      lonRad,
      radius,
      projKind,
      morph,
      knobClearance,
      seaLevel,
      heightScale,
    );
    this.topSliderKnobMesh.position.copy(topTrans.position);
    if (topTrans.normal.lengthSq() > 0.001) {
      this.topSliderKnobMesh.quaternion.setFromUnitVectors(
        new Vector3(0, 0, 1),
        topTrans.normal,
      );
    }

    const latRad = (this.projectionCenterLat() * Math.PI) / 180;
    const leftTrans = evaluateLeftBorderTrack(
      latRad,
      radius,
      projKind,
      morph,
      knobClearance,
      seaLevel,
      heightScale,
    );
    this.leftSliderKnobMesh.position.copy(leftTrans.position);
    if (leftTrans.normal.lengthSq() > 0.001) {
      this.leftSliderKnobMesh.quaternion.setFromUnitVectors(
        new Vector3(0, 0, 1),
        leftTrans.normal,
      );
    }
  }
}


