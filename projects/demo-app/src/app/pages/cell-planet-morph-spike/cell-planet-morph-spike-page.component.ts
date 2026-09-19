import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  findCellAt,
  findReachableCells,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetSurfaceSampler,
  IPlanetTectonics,
  IVec3,
  normalize,
  WorldProfileKind,
  WORLD_PROFILES,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  CellPlanetMorphViewComponent,
  computeSunDirectionFromTime,
  elevationColor,
  lavaOceanColor,
  MAP_PROJECTION_KINDS,
  MAP_PROJECTION_LABELS,
  MapProjectionKind,
  moistureColor,
  PlanetMapBorderStyle,
  plateColor,
  ProjectionTrackingMode,
  temperatureColor,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import { CellPlanetWorldService } from '../cell-planet-world.service';
import {
  CELL_PLANET_TERRAIN_STYLE_KINDS,
  CELL_PLANET_TERRAIN_STYLE_LABELS,
  CellPlanetTerrainStyle,
  isCellPlanetTerrainStyle,
  selectCellPlanetSurfaceSampler,
} from '../cell-planet-terrain-style';
import { CellPlanetQuery, readCellPlanetQuery } from '../cell-planet-view-query';

const OCEAN_COLOR = 'hsl(210, 55%, 22%)';
const GLOBE_RADIUS = 2.0;
const DEFAULT_HEIGHT_SCALE = 0.16;
const MORPH_SEGMENTS = 128;
const MORPH_RINGS = 64;

interface IGameUnit {
  id: string;
  name: string;
  kind: 'scout' | 'pioneer' | 'legion' | 'frigate' | 'airplane';
  color: string;
  currentCellId: number;
  targetCellId: number;
  direction: IVec3;
  targetDirection: IVec3;
  elevation: number;
  isNaval: boolean;
  isAir: boolean;
  group: Group;
  moveProgress: number;
  // Airplane flight fields
  flightAngle?: number;
  flightSpeed?: number;
  flightType?: 'greatCircle' | 'arcticCircuit' | 'southernCircuit';
  orbitBasisP?: Vector3;
  orbitBasisV?: Vector3;
  velocityDir?: Vector3;
}

export type CellPlanetMorphFillMode =
  | 'biome'
  | 'elevation'
  | 'plates'
  | 'temperature'
  | 'moisture';

@Component({
  selector: 'app-cell-planet-morph-spike-page',
  imports: [EngineModule, RouterLink, CellPlanetMorphViewComponent],
  templateUrl: './cell-planet-morph-spike-page.component.html',
  styleUrl: './cell-planet-morph-spike-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanetMorphSpikePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly worldService = inject(CellPlanetWorldService);

  readonly morphView = viewChild(CellPlanetMorphViewComponent);

  readonly cellCount = signal<number>(CELL_PLANET_U0_FIXTURE.cellCount);
  readonly seed = signal<number>(CELL_PLANET_U0_FIXTURE.seed);
  readonly relaxationIterations = signal<number>(CELL_PLANET_U0_FIXTURE.relaxationIterations);
  readonly worldProfileKind = signal<WorldProfileKind>(CELL_PLANET_U0_FIXTURE.worldProfile);
  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];
  readonly terrainStyle = signal<CellPlanetTerrainStyle>('blended');
  readonly terrainStyleKinds = CELL_PLANET_TERRAIN_STYLE_KINDS;
  readonly terrainStyleLabels = CELL_PLANET_TERRAIN_STYLE_LABELS;
  readonly fillMode = signal<CellPlanetMorphFillMode>('biome');
  readonly fillModes: CellPlanetMorphFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture'];
  readonly projectionKind = signal<MapProjectionKind>('equalEarth');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;
  readonly heightScale = signal(DEFAULT_HEIGHT_SCALE);
  readonly seabedRelief = signal(true);
  readonly showOcean = signal(true);
  readonly showVolcanoTerrain = signal(true);
  readonly autoPatrol = signal(true);
  readonly projectionTrackingMode = signal<ProjectionTrackingMode>('none');
  readonly projectionCenterInfo = signal<{ lonDeg: string; latDeg: string }>({ lonDeg: '0.0°', latDeg: '0.0°' });

  // Border & Tactical Overlay signals
  readonly showCellBorders = signal(true);
  readonly showTerritoryBorders = signal(true);
  readonly clampBordersToSeaLevel = signal(true);
  readonly adaptiveReliefSubdivision = signal(true);
  readonly tacticalRangeMode = signal(true);
  readonly selectedCellId = signal<number | null>(null);
  readonly hoveredCellId = signal<number | null>(null);

  // Map Frame Border signals
  readonly showMapBorder = signal(true);
  readonly mapBorderStyle = signal<PlanetMapBorderStyle>('cartographic');
  readonly mapBorderStyles: PlanetMapBorderStyle[] = ['cartographic', 'tactical', 'simple'];
  readonly mapBorderColor = signal('#38bdf8');
  readonly mapBorderWidth = signal(0.07);
  readonly mapBorderClearance = signal(0.04);
  readonly showBorderSliders = signal(true);
  readonly manualCenterLon = signal(0);
  readonly manualCenterLat = signal(0);

  get plateIdByCell(): number[] | null {
    return this.tectonics?.plateIdByCell ?? null;
  }

  readonly globeRadius = GLOBE_RADIUS;

  /** 0 = 3D Globe, 1 = 2.5D Map */
  readonly morphProgress = signal(0.0);
  readonly isAnimating = signal(false);
  readonly targetView = signal<'globe' | 'map'>('globe');
  private readonly preservedQueryParams = signal<CellPlanetQuery>({});
  readonly comparisonQueryParams = computed(() => ({
    ...this.preservedQueryParams(),
    cellCount: this.cellCount(),
    seed: this.seed(),
    relaxation: this.relaxationIterations(),
    worldProfile: this.worldProfileKind(),
    terrainStyle: this.terrainStyle(),
    projection: this.projectionKind(),
    fillMode: this.fillMode(),
  }));

  // Day / Night Cycle signals
  readonly dayNightEnabled = signal(false);
  readonly timeOfDay = signal(12.0); // hours [0..24), starts at noon
  readonly isPlayingDayNight = signal(false);
  readonly dayNightSpeed = signal(1.0); // 1x = 30s per 24h day
  readonly axialTiltDeg = signal(23.44);
  readonly seasonPreset = signal<'equinox' | 'summer' | 'winter'>('equinox');
  readonly seasonPhase = computed(() => {
    switch (this.seasonPreset()) {
      case 'summer':
        return 0.5;
      case 'winter':
        return 0.0;
      case 'equinox':
      default:
        return 0.25;
    }
  });
  readonly nightAmbient = signal(0.2);

  readonly sunLightPosition = computed<[number, number, number]>(() => {
    if (!this.dayNightEnabled()) {
      return [5, 8, 6];
    }
    const dir = computeSunDirectionFromTime(
      this.timeOfDay(),
      this.axialTiltDeg(),
      this.seasonPhase(),
    );
    const morph = this.morphProgress();
    // In 3D globe mode (morph=0): directional light shines from the sun position * 10
    // In 2.5D flat mode (morph=1): transitions to frontal studio light [5, 8, 6]
    // so flat map has even illumination while shader renders the day/night terminator wave.
    const lx = dir.x * 10 * (1 - morph) + 5 * morph;
    const ly = dir.y * 10 * (1 - morph) + 8 * morph;
    const lz = dir.z * 10 * (1 - morph) + 6 * morph;
    return [lx, ly, lz];
  });

  // Stats
  readonly triangles = computed(() => MORPH_SEGMENTS * MORPH_RINGS * 2 * 2);
  readonly vertices = computed(() => (MORPH_SEGMENTS + 1) * (MORPH_RINGS + 1) * 2);
  readonly activeUnitsCount = signal(0);

  // Focus & Camera tracking
  readonly focusMode = signal<'unit' | 'overview'>('unit');
  readonly focusedUnitId = signal<string>('Equatorial Express (Horizontal)');
  readonly availableUnits = signal<Array<{ id: string; name: string; color: string; isNaval: boolean; isAir: boolean }>>([]);

  // Camera signals for OrbitControls
  readonly cameraPosition = signal<[number, number, number]>([0, 0, 4.4]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);
  readonly orbitControlsActive = signal(true);

  readonly surfaceSampler = signal<IPlanetSurfaceSampler | null>(null);
  readonly oceanSubstance = computed<'water' | 'lava'>(() => WORLD_PROFILES[this.worldProfileKind()].oceanSubstance ?? 'water');

  readonly activeTrackingDirection = computed<IVec3 | null>(() => {
    if (this.focusMode() !== 'unit') return null;
    const id = this.focusedUnitId();
    const unit = this.units.find((u) => u.id === id);
    return unit ? unit.direction : null;
  });

  graph!: IPlanetGraphCore;
  private tectonics!: IPlanetTectonics;
  private ecology!: IPlanetEcology;
  private sampler!: IPlanetSurfaceSampler;
  seaLevelElevation = 0;
  private elevationMin = 0;
  private elevationMax = 0;

  private units: IGameUnit[] = [];
  private animationFrameId?: number;
  private readonly colorScratch = new Color();

  readonly resolveColor = computed(() => {
    const mode = this.fillMode();
    const substance = this.oceanSubstance();
    const graph = this.graph;
    const scratch = new Color();

    return (
      direction: IVec3,
      effectiveElevation: number,
      isLand: boolean,
    ): [number, number, number] => {
      if (!graph) return [0.3, 0.5, 0.3];
      const cell = findCellAt(graph, direction);
      const colorHex = this.resolveCellColor(cell.id, mode, substance);
      scratch.setStyle(colorHex);
      scratch.convertSRGBToLinear();
      return [scratch.r, scratch.g, scratch.b];
    };
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = readCellPlanetQuery(params);
      this.preservedQueryParams.set(query);
      const seedParam = params.get('seed');
      if (seedParam !== null && Number.isFinite(+seedParam)) this.seed.set(+seedParam);

      const cellCountParam = params.get('cellCount');
      if (cellCountParam !== null && Number.isFinite(+cellCountParam)) {
        this.cellCount.set(Math.max(200, Math.min(6000, +cellCountParam)));
      }

      const relaxationParam = params.get('relaxation');
      if (relaxationParam !== null && Number.isFinite(+relaxationParam)) {
        this.relaxationIterations.set(Math.max(0, Math.min(6, Math.round(+relaxationParam))));
      }

      const projParam = params.get('projection');
      if (projParam === 'equalEarth' || projParam === 'equirectangular') {
        this.projectionKind.set(projParam);
      }

      const profileParam = params.get('worldProfile');
      if (profileParam && this.worldProfileKinds.includes(profileParam as WorldProfileKind)) {
        this.worldProfileKind.set(profileParam as WorldProfileKind);
      }

      const terrainStyleParam = params.get('terrainStyle');
      const terrainStyle = terrainStyleParam ?? undefined;
      if (isCellPlanetTerrainStyle(terrainStyle)) {
        this.terrainStyle.set(terrainStyle);
      }

      const fillParam = params.get('fillMode');
      if (fillParam && this.fillModes.includes(fillParam as CellPlanetMorphFillMode)) {
        this.fillMode.set(fillParam as CellPlanetMorphFillMode);
      }

      this.rebuildWorld();
    });

    // Start live game unit animation loop
    this.startUnitTickLoop();

    // Forward scene clicks to cellPlanetMorphView for picking / selection
    this.engine.click$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event && this.engine.renderer?.domElement) {
          this.morphView()?.onClick(event, this.engine.renderer.domElement);
        }
      });

    // 3D border slider drag handling: disables OrbitControls during slider drag
    if (typeof window !== 'undefined') {
      const handlePointerDown = (e: PointerEvent) => {
        const dom = this.engine.renderer?.domElement;
        if (!dom || e.target !== dom) return;
        const handled = this.morphView()?.onPointerDown(e, dom);
        if (handled) {
          this.orbitControlsActive.set(false);
        }
      };

      const handlePointerMove = (e: PointerEvent) => {
        const dom = this.engine.renderer?.domElement;
        if (!dom) return;
        const view = this.morphView();
        if (view) {
          if (view.isDragging) {
            view.onPointerDrag(e, dom);
          } else if (e.target === dom) {
            view.onPointerMove(e, dom);
          }
        }
      };

      const handlePointerUp = () => {
        if (!this.orbitControlsActive()) {
          this.morphView()?.onPointerUp();
          this.orbitControlsActive.set(true);
        }
      };

      window.addEventListener('pointerdown', handlePointerDown);
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);

      this.destroyRef.onDestroy(() => {
        window.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      });
    }

    this.destroyRef.onDestroy(() => {
      if (this.animationFrameId !== undefined) cancelAnimationFrame(this.animationFrameId);
      this.disposeUnits();
    });
  }

  toggleView(): void {
    if (this.isAnimating()) return;
    const nextTarget = this.targetView() === 'globe' ? 'map' : 'globe';
    this.animateToView(nextTarget);
  }

  setMorphProgress(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.morphProgress.set(clamped);
    this.targetView.set(clamped > 0.5 ? 'map' : 'globe');
    const focused = this.focusMode() === 'unit'
      ? this.units.find((u) => u.id === this.focusedUnitId())
      : undefined;
    this.morphView()?.updateTracking(focused ? focused.direction : null, this.projectionTrackingMode());
    this.updateUnitsPositions();
    this.updateCameraForProgress(clamped);
  }

  onMorphSliderInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    this.setMorphProgress(val);
  }

  onProjectionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MapProjectionKind;
    if (this.projectionKinds.includes(value) && value !== this.projectionKind()) {
      this.projectionKind.set(value);
      this.updateUnitsPositions();
    }
  }

  onFillModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetMorphFillMode;
    if (this.fillModes.includes(value) && value !== this.fillMode()) {
      this.fillMode.set(value);
    }
  }

  onHeightScaleInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.heightScale.set(val);
      this.updateUnitsPositions();
    }
  }

  onSeabedReliefChange(event: Event): void {
    this.seabedRelief.set((event.target as HTMLInputElement).checked);
  }

  onShowOceanChange(event: Event): void {
    this.showOcean.set((event.target as HTMLInputElement).checked);
  }

  onVolcanoTerrainChange(event: Event): void {
    this.showVolcanoTerrain.set((event.target as HTMLInputElement).checked);
    this.rebuildWorld();
  }

  onWorldProfileChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as WorldProfileKind;
    if (this.worldProfileKinds.includes(value) && value !== this.worldProfileKind()) {
      this.worldProfileKind.set(value);
      this.rebuildWorld();
    }
  }

  onTerrainStyleChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isCellPlanetTerrainStyle(value) || value === this.terrainStyle()) return;
    this.terrainStyle.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...this.route.snapshot.queryParams, terrainStyle: value },
      replaceUrl: true,
    });
    this.rebuildWorld();
  }

  onAutoPatrolChange(event: Event): void {
    this.autoPatrol.set((event.target as HTMLInputElement).checked);
  }

  onProjectionTrackingChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as ProjectionTrackingMode;
    this.projectionTrackingMode.set(val);
    const focused = this.focusMode() === 'unit'
      ? this.units.find((u) => u.id === this.focusedUnitId())
      : undefined;
    this.morphView()?.updateTracking(focused ? focused.direction : null, val);
    this.updateUnitsPositions();
    this.updateCameraForProgress(this.morphProgress());
  }

  // Day / Night Cycle handlers
  onDayNightToggle(event: Event): void {
    this.dayNightEnabled.set((event.target as HTMLInputElement).checked);
  }

  togglePlayDayNight(): void {
    this.isPlayingDayNight.update((p) => !p);
  }

  onTimeOfDayInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.timeOfDay.set(val);
    }
  }

  onDayNightSpeedChange(event: Event): void {
    const val = parseFloat((event.target as HTMLSelectElement).value);
    if (Number.isFinite(val)) {
      this.dayNightSpeed.set(val);
    }
  }

  onSeasonPresetChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as
      | 'equinox'
      | 'summer'
      | 'winter';
    this.seasonPreset.set(val);
  }

  onNightAmbientInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.nightAmbient.set(val);
    }
  }

  formatTimeOfDay(hours: number): string {
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours - Math.floor(hours)) * 60);
    const hh = h.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    let label = '';
    if (h >= 5 && h < 8) label = 'Dawn';
    else if (h >= 8 && h < 17) label = 'Day';
    else if (h >= 17 && h < 20) label = 'Dusk';
    else label = 'Night';
    return `${hh}:${mm} (${label})`;
  }

  selectFocus(target: 'overview' | string): void {
    if (target === 'overview') {
      this.focusMode.set('overview');
      this.morphView()?.updateTracking(null, 'none');
    } else {
      this.focusMode.set('unit');
      this.focusedUnitId.set(target);
      const focused = this.units.find((u) => u.id === target);
      this.morphView()?.updateTracking(focused ? focused.direction : null, this.projectionTrackingMode());
    }
    this.updateUnitsPositions();
    this.updateCameraForProgress(this.morphProgress());
  }

  private animateToView(target: 'globe' | 'map'): void {
    this.isAnimating.set(true);
    this.targetView.set(target);

    const startProgress = this.morphProgress();
    const targetProgress = target === 'map' ? 1.0 : 0.0;
    const durationMs = 1400;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1.0, elapsed / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const current = startProgress + (targetProgress - startProgress) * eased;

      this.setMorphProgress(current);

      if (t < 1.0) {
        requestAnimationFrame(step);
      } else {
        this.setMorphProgress(targetProgress);
        this.isAnimating.set(false);
      }
    };

    requestAnimationFrame(step);
  }

  onCellClicked(hit: { cellId: number; direction: IVec3; point: Vector3 }): void {
    if (hit.cellId < 0 || !this.graph || !this.tectonics) return;
    this.selectedCellId.set(hit.cellId);

    const view = this.morphView();
    const overlay = view?.tacticalOverlay();
    if (!overlay) return;

    if (this.tacticalRangeMode()) {
      const isLand = this.tectonics.isLand[hit.cellId];
      const reachable = findReachableCells(
        this.graph,
        hit.cellId,
        2,
        (id) => this.tectonics.isLand[id] === isLand,
      );
      overlay.clearAll();
      overlay.setReachableRange(reachable, isLand ? '#22c55e' : '#38bdf8', 0.45);
      overlay.setSelectedCell(hit.cellId, '#f59e0b', 0.85);
      overlay.update();
    } else {
      overlay.clearAll();
      overlay.setSelectedCell(hit.cellId, '#f59e0b', 0.85);
      overlay.update();
    }
  }

  onCellHovered(hit: { cellId: number | null; direction: IVec3 | null }): void {
    this.hoveredCellId.set(hit.cellId);
  }

  toggleCellBorders(): void {
    this.showCellBorders.update((v) => !v);
  }

  toggleTerritoryBorders(): void {
    this.showTerritoryBorders.update((v) => !v);
  }

  toggleClampBordersToSeaLevel(): void {
    this.clampBordersToSeaLevel.update((v) => !v);
  }

  toggleAdaptiveReliefSubdivision(): void {
    this.adaptiveReliefSubdivision.update((v) => !v);
  }

  toggleTacticalRangeMode(): void {
    this.tacticalRangeMode.update((v) => !v);
    if (!this.tacticalRangeMode()) {
      this.morphView()?.tacticalOverlay()?.clearAll();
    } else if (this.selectedCellId() !== null) {
      this.onCellClicked({
        cellId: this.selectedCellId()!,
        direction: this.graph.cells[this.selectedCellId()!].center,
        point: new Vector3(),
      });
    }
  }

  toggleMapBorder(): void {
    this.showMapBorder.update((v) => !v);
  }

  onMapBorderStyleChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as PlanetMapBorderStyle;
    if (this.mapBorderStyles.includes(val)) {
      this.mapBorderStyle.set(val);
    }
  }

  onMapBorderWidthInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.mapBorderWidth.set(val);
    }
  }

  onMapBorderClearanceInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.mapBorderClearance.set(val);
    }
  }

  toggleBorderSliders(): void {
    this.showBorderSliders.update((v) => !v);
  }

  onManualCenterLonInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.manualCenterLon.set(val);
      this.syncProjectionCenterInfo();
    }
  }

  onManualCenterLatInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.manualCenterLat.set(val);
      this.syncProjectionCenterInfo();
    }
  }

  resetProjectionCenter(): void {
    this.manualCenterLon.set(0);
    this.manualCenterLat.set(0);
    this.syncProjectionCenterInfo();
  }

  onProjectionCenterChanged(event: { lonDeg: number; latDeg: number }): void {
    this.manualCenterLon.set(event.lonDeg);
    this.manualCenterLat.set(event.latDeg);
    this.syncProjectionCenterInfo();
  }

  private syncProjectionCenterInfo(): void {
    if (this.projectionTrackingMode() === 'none') {
      const lon = this.manualCenterLon();
      const lat = this.manualCenterLat();
      const lonStr = Math.abs(lon) < 0.01 ? '0.0°' : `${lon > 0 ? '+' : ''}${lon.toFixed(1)}°`;
      const latStr = Math.abs(lat) < 0.01 ? '0.0°' : `${lat > 0 ? '+' : ''}${lat.toFixed(1)}°`;
      this.projectionCenterInfo.set({ lonDeg: lonStr, latDeg: latStr });
    }
  }

  private updateCameraForProgress(t: number): void {
    const view = this.morphView();
    if (this.focusMode() === 'unit' && view) {
      const unit = this.units.find((u) => u.id === this.focusedUnitId()) ?? this.units[0];
      if (unit) {
        const unitPos = unit.group.position;
        const transform = view.evaluateUnitTransform(unit.direction, unit.elevation);

        const worldNormal = transform.normal.clone().normalize();
        const globeOffset = worldNormal.clone().multiplyScalar(2.6);
        const mapOffset = new Vector3(0, -1.8, 2.4);

        const offset = new Vector3().lerpVectors(globeOffset, mapOffset, t);
        const camPos = new Vector3().addVectors(unitPos, offset);

        this.cameraPosition.set([camPos.x, camPos.y, camPos.z]);
        this.cameraTarget.set([unitPos.x, unitPos.y, unitPos.z]);
        return;
      }
    }

    // Overview mode: entire world framed
    const globeCamPos = new Vector3(0, 0, 4.6);
    const globeTarget = new Vector3(0, 0, 0);

    const mapCamPos = new Vector3(0, -2.4, 5.2);
    const mapTarget = new Vector3(0, 0, 0);

    const currentPos = new Vector3().lerpVectors(globeCamPos, mapCamPos, t);
    const currentTarget = new Vector3().lerpVectors(globeTarget, mapTarget, t);

    this.cameraPosition.set([currentPos.x, currentPos.y, currentPos.z]);
    this.cameraTarget.set([currentTarget.x, currentTarget.y, currentTarget.z]);
  }

  private rebuildWorld(): void {
    const seed = this.seed();
    const world = this.worldService.build({
      cellCount: this.cellCount(),
      seed,
      relaxationIterations: this.relaxationIterations(),
      worldProfileKind: this.worldProfileKind(),
    });
    const { graph, tectonics, ecology, features, seaLevelElevation } = world;

    let eMin = Infinity;
    let eMax = -Infinity;
    for (const e of tectonics.elevation) {
      eMin = Math.min(eMin, e);
      eMax = Math.max(eMax, e);
    }

    this.graph = graph;
    this.tectonics = tectonics;
    this.ecology = ecology;
    this.seaLevelElevation = seaLevelElevation;
    this.elevationMin = eMin;
    this.elevationMax = eMax;
    this.sampler = selectCellPlanetSurfaceSampler(
      world,
      this.terrainStyle(),
      this.showVolcanoTerrain(),
    );

    this.surfaceSampler.set(this.sampler);
    this.spawnGameUnits();
  }

  private spawnGameUnits(): void {
    this.disposeUnits();

    const landCells: number[] = [];
    const oceanCells: number[] = [];

    for (const cell of this.graph.cells) {
      if (this.tectonics.isLand[cell.id]) landCells.push(cell.id);
      else oceanCells.push(cell.id);
    }

    const configs: Array<{
      name: string;
      kind: IGameUnit['kind'];
      color: string;
      isNaval: boolean;
      isAir: boolean;
      cellId: number;
      flightType?: IGameUnit['flightType'];
      orbitBasisP?: Vector3;
      orbitBasisV?: Vector3;
      flightSpeed?: number;
    }> = [
      {
        name: 'Equatorial Express (Horizontal)',
        kind: 'airplane',
        color: '#06b6d4', // Cyan
        isNaval: false,
        isAir: true,
        cellId: 0,
        flightType: 'greatCircle',
        orbitBasisP: new Vector3(0, 0, 1),
        orbitBasisV: new Vector3(1, 0, 0),
        flightSpeed: 0.45,
      },
      {
        name: 'Polar Valkyrie (Vertical / Poles)',
        kind: 'airplane',
        color: '#f43f5e', // Rose
        isNaval: false,
        isAir: true,
        cellId: 0,
        flightType: 'greatCircle',
        orbitBasisP: new Vector3(0, 0, 1),
        orbitBasisV: new Vector3(0, 1, 0),
        flightSpeed: 0.45,
      },
      {
        name: 'Skyward One (Transcontinental)',
        kind: 'airplane',
        color: '#38bdf8', // Electric Sky Blue
        isNaval: false,
        isAir: true,
        cellId: 0,
        flightType: 'greatCircle',
        orbitBasisP: new Vector3(1.0, 0.15, 0.0).normalize(),
        orbitBasisV: new Vector3(0.0, 0.42, 1.0).normalize(),
        flightSpeed: 0.35,
      },
      {
        name: 'Polar Express (Arctic Patrol)',
        kind: 'airplane',
        color: '#f59e0b', // Amber Gold
        isNaval: false,
        isAir: true,
        cellId: 0,
        flightType: 'arcticCircuit',
        flightSpeed: 0.40,
      },
      {
        name: 'Pacific Phantom (Southern Express)',
        kind: 'airplane',
        color: '#c084fc', // Bright Purple
        isNaval: false,
        isAir: true,
        cellId: 0,
        flightType: 'southernCircuit',
        flightSpeed: 0.38,
      },
      {
        name: 'Scout Vanguard',
        kind: 'scout',
        color: '#ffcc00', // Gold
        isNaval: false,
        isAir: false,
        cellId: landCells[Math.floor(landCells.length * 0.15)] ?? 0,
      },
      {
        name: 'Pioneer Settler',
        kind: 'pioneer',
        color: '#00e5ff', // Cyan
        isNaval: false,
        isAir: false,
        cellId: landCells[Math.floor(landCells.length * 0.45)] ?? 10,
      },
      {
        name: 'Imperial Legion',
        kind: 'legion',
        color: '#ff3d71', // Crimson
        isNaval: false,
        isAir: false,
        cellId: landCells[Math.floor(landCells.length * 0.75)] ?? 20,
      },
      {
        name: 'Ironclad Frigate',
        kind: 'frigate',
        color: '#00e676', // Emerald Sea Green
        isNaval: true,
        isAir: false,
        cellId: oceanCells[Math.floor(oceanCells.length * 0.5)] ?? 30,
      },
    ];

    for (const config of configs) {
      const cell = this.graph.cells[config.cellId] ?? this.graph.cells[0];
      if (!cell) continue;

      let group: Group;
      if (config.kind === 'airplane') {
        group = this.createAirplaneModel(config.color);
      } else {
        group = new Group();

        const baseGeo = new CylinderGeometry(0.08, 0.08, 0.02, 16);
        const baseMat = new MeshStandardMaterial({ color: '#22272e', roughness: 0.5, metalness: 0.8 });
        const baseMesh = new Mesh(baseGeo, baseMat);
        baseMesh.position.y = 0.01;
        group.add(baseMesh);

        const tokenGeo = new OctahedronGeometry(0.075);
        const tokenMat = new MeshStandardMaterial({
          color: config.color,
          roughness: 0.2,
          metalness: 0.3,
          emissive: config.color,
          emissiveIntensity: 0.25,
        });
        const tokenMesh = new Mesh(tokenGeo, tokenMat);
        tokenMesh.position.y = 0.10;
        group.add(tokenMesh);

        const ringGeo = new TorusGeometry(0.11, 0.012, 8, 24);
        const ringMat = new MeshStandardMaterial({
          color: config.color,
          roughness: 0.3,
          emissive: config.color,
          emissiveIntensity: 0.5,
        });
        const ringMesh = new Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.y = 0.02;
        group.add(ringMesh);
      }

      group.name = `unit-${config.name}`;
      this.engine.scene.add(group);

      const elev = config.isAir
        ? this.seaLevelElevation + 0.18
        : config.isNaval
          ? this.seaLevelElevation
          : Math.max(this.seaLevelElevation, this.sampler.sample(cell.center).elevation);

      const initDir = config.isAir && config.orbitBasisP
        ? { x: config.orbitBasisP.x, y: config.orbitBasisP.y, z: config.orbitBasisP.z }
        : { ...cell.center };

      this.units.push({
        id: config.name,
        name: config.name,
        kind: config.kind,
        color: config.color,
        currentCellId: cell.id,
        targetCellId: cell.id,
        direction: initDir,
        targetDirection: { ...cell.center },
        elevation: elev,
        isNaval: config.isNaval,
        isAir: config.isAir,
        group,
        moveProgress: 1.0,
        flightAngle: 0,
        flightSpeed: config.flightSpeed,
        flightType: config.flightType,
        orbitBasisP: config.orbitBasisP,
        orbitBasisV: config.orbitBasisV,
        velocityDir: config.orbitBasisV ? config.orbitBasisV.clone() : undefined,
      });
    }

    this.activeUnitsCount.set(this.units.length);
    this.availableUnits.set(
      this.units.map((u) => ({ id: u.id, name: u.name, color: u.color, isNaval: u.isNaval, isAir: u.isAir })),
    );
    this.updateUnitsPositions();
    this.updateCameraForProgress(this.morphProgress());
  }

  private createAirplaneModel(color: string): Group {
    const group = new Group();

    const bodyGeo = new ConeGeometry(0.045, 0.28, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new MeshStandardMaterial({ color: '#f8fafc', roughness: 0.2, metalness: 0.7 });
    const bodyMesh = new Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.05;
    group.add(bodyMesh);

    const wingGeo = new BoxGeometry(0.32, 0.012, 0.12);
    const wingMat = new MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
    const wingMesh = new Mesh(wingGeo, wingMat);
    wingMesh.position.set(0, 0.048, -0.02);
    group.add(wingMesh);

    const tailGeo = new BoxGeometry(0.012, 0.07, 0.06);
    const tailMat = new MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
    const tailMesh = new Mesh(tailGeo, tailMat);
    tailMesh.position.set(0, 0.085, -0.09);
    group.add(tailMesh);

    const engineGeo = new CylinderGeometry(0.015, 0.015, 0.03, 8);
    engineGeo.rotateX(Math.PI / 2);
    const engineMat = new MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#38bdf8',
      emissiveIntensity: 1.2,
    });
    const engineMesh = new Mesh(engineGeo, engineMat);
    engineMesh.position.set(0, 0.05, -0.14);
    group.add(engineMesh);

    return group;
  }

  private updateUnitsPositions(): void {
    const view = this.morphView();
    if (!view) return;
    const upVector = new Vector3(0, 1, 0);

    for (const unit of this.units) {
      const transform = view.evaluateUnitTransform(unit.direction, unit.elevation);

      // Lift slightly above surface to prevent clipping
      unit.group.position.copy(transform.position).addScaledVector(transform.normal, 0.02);

      if (unit.isAir && unit.velocityDir) {
        const fwdPoint: IVec3 = {
          x: unit.direction.x + unit.velocityDir.x * 0.05,
          y: unit.direction.y + unit.velocityDir.y * 0.05,
          z: unit.direction.z + unit.velocityDir.z * 0.05,
        };
        const fwdTrans = view.evaluateUnitTransform(fwdPoint, unit.elevation);
        const fwdDir = new Vector3().subVectors(fwdTrans.position, transform.position).normalize();
        const up = transform.normal;
        const right = new Vector3().crossVectors(fwdDir, up).normalize();
        const correctedUp = new Vector3().crossVectors(right, fwdDir).normalize();
        const rotMat = new Matrix4().makeBasis(right, correctedUp, fwdDir);
        unit.group.quaternion.setFromRotationMatrix(rotMat);
      } else {
        unit.group.quaternion.setFromUnitVectors(upVector, transform.normal);
      }
    }
  }

  private startUnitTickLoop(): void {
    let lastTime = performance.now();

    const tick = (now: number) => {
      const deltaSec = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      // Advance time of day when playing Day/Night cycle
      if (this.dayNightEnabled() && this.isPlayingDayNight()) {
        const hoursPerSec = (24 / 30) * this.dayNightSpeed();
        const nextTime = (this.timeOfDay() + deltaSec * hoursPerSec) % 24;
        this.timeOfDay.set(nextTime);
      }

      if (this.autoPatrol() && this.units.length > 0) {
        for (const unit of this.units) {
          if (unit.isAir) {
            unit.flightAngle = (unit.flightAngle ?? 0) + deltaSec * (unit.flightSpeed ?? 0.35);
            const ang = unit.flightAngle;

            if (unit.flightType === 'greatCircle' && unit.orbitBasisP && unit.orbitBasisV) {
              const p = unit.orbitBasisP;
              const v = unit.orbitBasisV;
              const curP = new Vector3().addScaledVector(p, Math.cos(ang)).addScaledVector(v, Math.sin(ang)).normalize();
              const curV = new Vector3().addScaledVector(p, -Math.sin(ang)).addScaledVector(v, Math.cos(ang)).normalize();

              unit.direction = { x: curP.x, y: curP.y, z: curP.z };
              unit.velocityDir = curV;
            } else if (unit.flightType === 'arcticCircuit') {
              const latRad = (61.5 + 6.5 * Math.sin(ang * 2)) * (Math.PI / 180);
              const lonRad = ang;
              const cosLat = Math.cos(latRad);
              const sinLat = Math.sin(latRad);

              unit.direction = {
                x: cosLat * Math.sin(lonRad),
                y: sinLat,
                z: cosLat * Math.cos(lonRad),
              };

              const dLon = 1.0;
              const dLat = (13.0 * Math.cos(ang * 2)) * (Math.PI / 180);
              const vx = -sinLat * dLat * Math.sin(lonRad) + cosLat * Math.cos(lonRad) * dLon;
              const vy = cosLat * dLat;
              const vz = -sinLat * dLat * Math.cos(lonRad) - cosLat * Math.sin(lonRad) * dLon;
              unit.velocityDir = new Vector3(vx, vy, vz).normalize();
            } else if (unit.flightType === 'southernCircuit') {
              const latRad = (-30.0 + 6.0 * Math.cos(ang * 2)) * (Math.PI / 180);
              const lonRad = -ang;
              const cosLat = Math.cos(latRad);
              const sinLat = Math.sin(latRad);

              unit.direction = {
                x: cosLat * Math.sin(lonRad),
                y: sinLat,
                z: cosLat * Math.cos(lonRad),
              };

              const dLon = -1.0;
              const dLat = (-12.0 * Math.sin(ang * 2)) * (Math.PI / 180);
              const vx = -sinLat * dLat * Math.sin(lonRad) + cosLat * Math.cos(lonRad) * dLon;
              const vy = cosLat * dLat;
              const vz = -sinLat * dLat * Math.cos(lonRad) - cosLat * Math.sin(lonRad) * dLon;
              unit.velocityDir = new Vector3(vx, vy, vz).normalize();
            }
            unit.elevation = this.seaLevelElevation + 0.18;
          } else {
            if (unit.moveProgress >= 1.0 && Math.random() < deltaSec * 0.5) {
              const currentCell = this.graph.cells[unit.currentCellId];
              if (currentCell) {
                const eligibleNeighbors = currentCell.neighbors.filter((nId) => {
                  const isLand = this.tectonics.isLand[nId];
                  return unit.isNaval ? !isLand : isLand;
                });

                if (eligibleNeighbors.length > 0) {
                  const pick = eligibleNeighbors[Math.floor(Math.random() * eligibleNeighbors.length)];
                  unit.targetCellId = pick;
                  unit.targetDirection = { ...this.graph.cells[pick].center };
                  unit.moveProgress = 0.0;
                }
              }
            }

            if (unit.moveProgress < 1.0) {
              unit.moveProgress = Math.min(1.0, unit.moveProgress + deltaSec * 0.8);
              const p = unit.moveProgress;

              const interpDir = normalize({
                x: unit.direction.x * (1 - p) + unit.targetDirection.x * p,
                y: unit.direction.y * (1 - p) + unit.targetDirection.y * p,
                z: unit.direction.z * (1 - p) + unit.targetDirection.z * p,
              });
              unit.direction = interpDir;

              const targetElevation = unit.isNaval
                ? this.seaLevelElevation
                : Math.max(this.seaLevelElevation, this.sampler.sample(interpDir).elevation);
              unit.elevation = unit.elevation * (1 - p) + targetElevation * p;

              if (unit.moveProgress >= 1.0) {
                unit.currentCellId = unit.targetCellId;
              }
            }
          }
        }

        // Center readout & live tracking
        const focused = this.focusMode() === 'unit'
          ? this.units.find((u) => u.id === this.focusedUnitId())
          : undefined;

        const view = this.morphView();
        if (view) {
          view.updateTracking(
            focused ? focused.direction : null,
            this.projectionTrackingMode(),
          );
        }

        if (this.projectionTrackingMode() !== 'none' && focused) {
          const latDeg = (Math.asin(Math.max(-1, Math.min(1, focused.direction.y))) * 180 / Math.PI).toFixed(1);
          const lonDeg = (Math.atan2(focused.direction.x, focused.direction.z) * 180 / Math.PI).toFixed(1);
          this.projectionCenterInfo.set({
            lonDeg: `${lonDeg}°`,
            latDeg: this.projectionTrackingMode() === 'meridian' ? '0.0° (Poles Locked)' : `${latDeg}°`,
          });
        } else {
          this.projectionCenterInfo.set({ lonDeg: '0.0° (Greenwich)', latDeg: '0.0° (Equator)' });
        }

        this.updateUnitsPositions();
        if (this.focusMode() === 'unit' && !this.isAnimating()) {
          this.updateCameraForProgress(this.morphProgress());
        }
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private resolveCellColor(
    cellId: number,
    mode: CellPlanetMorphFillMode,
    oceanSubstance: 'water' | 'lava',
  ): string {
    if (cellId < 0 || cellId >= this.tectonics.elevation.length) {
      return oceanSubstance === 'lava' ? lavaOceanColor() : OCEAN_COLOR;
    }
    if (oceanSubstance === 'lava' && this.ecology.waterBodyKind[cellId] === 'ocean') {
      return lavaOceanColor();
    }
    if (mode === 'plates') return plateColor(this.tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      return elevationColor(
        this.tectonics.elevation[cellId],
        this.tectonics.seaLevelElevation,
        this.elevationMin,
        this.elevationMax,
      );
    }
    if (mode === 'temperature') return temperatureColor(this.ecology.temperature[cellId]);
    if (mode === 'moisture') return moistureColor(this.ecology.moisture[cellId]);
    return biomeColor(this.ecology.biome[cellId]);
  }

  private disposeUnits(): void {
    for (const unit of this.units) {
      this.engine.scene.remove(unit.group);
      unit.group.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
    this.units = [];
    this.activeUnitsCount.set(0);
  }
}
