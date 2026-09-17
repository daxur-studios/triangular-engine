import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IUniform,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  createPlanetSurfaceSampler,
  deriveIsLand,
  findCellAt,
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
  elevationColor,
  IMapProjection,
  lavaOceanColor,
  MAP_PROJECTIONS,
  MAP_PROJECTION_KINDS,
  MAP_PROJECTION_LABELS,
  MapProjectionKind,
  moistureColor,
  plateColor,
  temperatureColor,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_GENERATION_DEFAULTS } from '../cell-planet-generation-config';

const OCEAN_COLOR = 'hsl(210, 55%, 22%)';
import {
  buildOceanMorphGeometry,
  buildPlanetMorphGeometry,
  evaluateSurfaceTransform,
  IPlanetMorphGeometryData,
  IProjectionBasis,
} from './planet-morph-geometry';
import {
  createPlanetMorphMaterial,
  IDynamicProjectionUniforms,
} from './planet-morph-material';

const GLOBE_RADIUS = 2.0;
const DEFAULT_HEIGHT_SCALE = 0.16;
const MORPH_SEGMENTS = 128;
const MORPH_RINGS = 64;

export type ProjectionTrackingMode = 'none' | 'meridian' | 'oblique';

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
  imports: [EngineModule, RouterLink],
  templateUrl: './cell-planet-morph-spike-page.component.html',
  styleUrl: './cell-planet-morph-spike-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanetMorphSpikePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cellCount = signal<number>(1500);
  readonly seed = signal<number>(5);
  readonly relaxationIterations = signal<number>(2);
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];
  readonly fillMode = signal<CellPlanetMorphFillMode>('biome');
  readonly fillModes: CellPlanetMorphFillMode[] = ['biome', 'elevation', 'plates', 'temperature', 'moisture'];
  readonly projectionKind = signal<MapProjectionKind>('equalEarth');
  readonly projectionKinds = MAP_PROJECTION_KINDS;
  readonly projectionLabels = MAP_PROJECTION_LABELS;
  readonly heightScale = signal(DEFAULT_HEIGHT_SCALE);
  readonly seabedRelief = signal(true);
  readonly showOcean = signal(true);
  readonly autoPatrol = signal(true);
  readonly projectionTrackingMode = signal<ProjectionTrackingMode>('none');
  readonly projectionCenterInfo = signal<{ lonDeg: string; latDeg: string }>({ lonDeg: '0.0°', latDeg: '0.0°' });

  /** 0 = 3D Globe, 1 = 2.5D Map */
  readonly morphProgress = signal(0.0);
  readonly isAnimating = signal(false);
  readonly targetView = signal<'globe' | 'map'>('globe');

  // Stats
  readonly triangles = signal(0);
  readonly vertices = signal(0);
  readonly activeUnitsCount = signal(0);

  // Focus & Camera tracking
  readonly focusMode = signal<'unit' | 'overview'>('unit');
  readonly focusedUnitId = signal<string>('Equatorial Express (Horizontal)');
  readonly availableUnits = signal<Array<{ id: string; name: string; color: string; isNaval: boolean; isAir: boolean }>>([]);

  // Camera signals for OrbitControls
  readonly cameraPosition = signal<[number, number, number]>([0, 0, 4.4]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0, 0]);

  private graph!: IPlanetGraphCore;
  private tectonics!: IPlanetTectonics;
  private ecology!: IPlanetEcology;
  private sampler!: IPlanetSurfaceSampler;
  private seaLevelElevation = 0;
  private elevationMin = 0;
  private elevationMax = 0;

  private terrainGeometryData?: IPlanetMorphGeometryData;
  private oceanGeometryData?: IPlanetMorphGeometryData;
  private mapWorldGroup?: Group;
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
    uRadius: { value: GLOBE_RADIUS },
    uProjectionType: { value: 1 },
  };

  private units: IGameUnit[] = [];
  private animationFrameId?: number;
  private patrolIntervalId?: ReturnType<typeof setInterval>;
  private readonly colorScratch = new Color();

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const seedParam = params.get('seed');
      if (seedParam !== null && Number.isFinite(+seedParam)) this.seed.set(+seedParam);

      const cellCountParam = params.get('cellCount');
      if (cellCountParam !== null && Number.isFinite(+cellCountParam)) {
        this.cellCount.set(Math.max(200, Math.min(6000, +cellCountParam)));
      }

      const projParam = params.get('projection');
      if (projParam === 'equalEarth' || projParam === 'equirectangular') {
        this.projectionKind.set(projParam);
      }

      const fillParam = params.get('fillMode');
      if (fillParam && this.fillModes.includes(fillParam as CellPlanetMorphFillMode)) {
        this.fillMode.set(fillParam as CellPlanetMorphFillMode);
      }

      this.rebuildWorld();
    });

    // Start live game unit animation loop
    this.startUnitTickLoop();

    this.destroyRef.onDestroy(() => {
      if (this.animationFrameId !== undefined) cancelAnimationFrame(this.animationFrameId);
      if (this.patrolIntervalId !== undefined) clearInterval(this.patrolIntervalId);
      this.disposeMeshes();
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
    this.dynamicUniforms.uMorph.value = clamped;
    this.targetView.set(clamped > 0.5 ? 'map' : 'globe');
    this.updateCameraForProgress(clamped);
    this.updateUnitsPositions();
  }

  onMorphSliderInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    this.setMorphProgress(val);
  }

  onProjectionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MapProjectionKind;
    if (this.projectionKinds.includes(value) && value !== this.projectionKind()) {
      this.projectionKind.set(value);
      this.dynamicUniforms.uProjectionType.value = value === 'equirectangular' ? 0 : 1;
      this.rebuildMeshes();
      this.updateUnitsPositions();
    }
  }

  onFillModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CellPlanetMorphFillMode;
    if (this.fillModes.includes(value) && value !== this.fillMode()) {
      this.fillMode.set(value);
      this.rebuildMeshes();
    }
  }

  onHeightScaleInput(event: Event): void {
    const val = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(val)) {
      this.heightScale.set(val);
      this.rebuildMeshes();
      this.updateUnitsPositions();
    }
  }

  onSeabedReliefChange(event: Event): void {
    this.seabedRelief.set((event.target as HTMLInputElement).checked);
    this.rebuildMeshes();
  }

  onShowOceanChange(event: Event): void {
    this.showOcean.set((event.target as HTMLInputElement).checked);
    if (this.oceanMesh) this.oceanMesh.visible = this.showOcean();
  }

  onAutoPatrolChange(event: Event): void {
    this.autoPatrol.set((event.target as HTMLInputElement).checked);
  }

  onProjectionTrackingChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as ProjectionTrackingMode;
    this.projectionTrackingMode.set(val);
    this.updateUnitsPositions();
    this.updateCameraForProgress(this.morphProgress());
  }

  selectFocus(target: 'overview' | string): void {
    if (target === 'overview') {
      this.focusMode.set('overview');
    } else {
      this.focusMode.set('unit');
      this.focusedUnitId.set(target);
    }
    this.updateCameraForProgress(this.morphProgress());
  }

  computeActiveProjectionBasis(unit?: IGameUnit): IProjectionBasis | undefined {
    const mode = this.projectionTrackingMode();
    if (mode === 'none' || !unit) {
      return undefined;
    }

    if (mode === 'meridian') {
      // Rotate longitude only: Africa vs America in center; poles stay fixed at top/bottom (+Y / -Y)
      const normDir = normalize(unit.direction);
      const lon = Math.atan2(normDir.x, normDir.z);
      const forward: IVec3 = { x: Math.sin(lon), y: 0, z: Math.cos(lon) };
      const up: IVec3 = { x: 0, y: 1, z: 0 };
      const right: IVec3 = { x: Math.cos(lon), y: 0, z: -Math.sin(lon) };
      return { forward, up, right };
    }

    // Full Oblique / Transverse: unit's 3D direction becomes the forward axis
    const forward = normalize(unit.direction);
    const worldUp: IVec3 = forward.y > 0.999
      ? { x: 0, y: 0, z: -1 }
      : forward.y < -0.999
        ? { x: 0, y: 0, z: 1 }
        : { x: 0, y: 1, z: 0 };
    // Project worldUp onto tangent plane at forward
    const dot = worldUp.x * forward.x + worldUp.y * forward.y + worldUp.z * forward.z;
    const tanUp = {
      x: worldUp.x - dot * forward.x,
      y: worldUp.y - dot * forward.y,
      z: worldUp.z - dot * forward.z,
    };
    const up = normalize(tanUp);
    // right = up x forward
    const right: IVec3 = {
      x: up.y * forward.z - up.z * forward.y,
      y: up.z * forward.x - up.x * forward.z,
      z: up.x * forward.y - up.y * forward.x,
    };
    return { forward, up, right };
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
      // Smooth ease in-out
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

  private updateCameraForProgress(t: number): void {
    if (this.focusMode() === 'unit') {
      const unit = this.units.find((u) => u.id === this.focusedUnitId()) ?? this.units[0];
      if (unit) {
        const unitPos = unit.group.position;
        const projection = MAP_PROJECTIONS[this.projectionKind()];
        const mapWidth = this.terrainGeometryData?.mapWidth ?? 2 * Math.PI * GLOBE_RADIUS;
        const mapHeight = this.terrainGeometryData?.mapHeight ?? Math.PI * GLOBE_RADIUS;

        const activeBasis = this.computeActiveProjectionBasis(unit);
        const transform = evaluateSurfaceTransform(
          unit.direction,
          unit.elevation,
          GLOBE_RADIUS,
          this.heightScale(),
          projection,
          mapWidth,
          mapHeight,
          t,
          activeBasis,
        );

        // World-oriented surface normal
        const worldNormal = transform.normal.clone().normalize();

        // In 3D Globe: look at the unit from outward along its surface normal
        const globeOffset = worldNormal.clone().multiplyScalar(2.6);

        // In 2.5D Map: look at the unit from slightly south (-Y) and elevated (+Z) at a 45-deg oblique angle
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
    const profile = WORLD_PROFILES[this.worldProfileKind()];

    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed,
      relaxationIterations: this.relaxationIterations(),
      jitter: CELL_PLANET_GENERATION_DEFAULTS.jitter,
    });

    const tectonics = buildPlanetTectonics(graph, {
      plateCount: CELL_PLANET_GENERATION_DEFAULTS.plateCount,
      seed,
      ...profile.tectonics,
    });

    const seaLevelElevation = tectonics.seaLevelElevation;
    tectonics.isLand = deriveIsLand(
      graph,
      tectonics.elevation,
      seaLevelElevation,
      profile.tectonics?.minRegionCellFraction,
    );

    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: profile.climate,
      biomes: profile.biomes,
    });

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
    this.sampler = createPlanetSurfaceSampler(graph, tectonics, ecology);

    this.rebuildMeshes();
    this.spawnGameUnits();
  }

  private rebuildMeshes(): void {
    this.disposeMeshes();

    const profile = WORLD_PROFILES[this.worldProfileKind()];
    const oceanSubstance = profile.oceanSubstance;

    this.terrainGeometryData = buildPlanetMorphGeometry({
      sampler: this.sampler,
      radius: GLOBE_RADIUS,
      heightScale: this.heightScale(),
      longitudeSegments: MORPH_SEGMENTS,
      latitudeRings: MORPH_RINGS,
      projectionKind: this.projectionKind(),
      seabedRelief: this.seabedRelief(),
      seaLevelElevation: this.seaLevelElevation,
      resolveColor: (direction) => {
        const cell = findCellAt(this.graph, direction);
        const colorHex = this.resolveCellColor(cell.id, this.fillMode(), oceanSubstance);
        this.colorScratch.setStyle(colorHex);
        this.colorScratch.convertSRGBToLinear();
        return [this.colorScratch.r, this.colorScratch.g, this.colorScratch.b];
      },
    });

    this.mapWorldGroup = new Group();
    this.mapWorldGroup.name = 'map-world-group';
    this.engine.scene.add(this.mapWorldGroup);

    const mapWidth = this.terrainGeometryData.mapWidth;
    const mapHeight = this.terrainGeometryData.mapHeight;

    this.dynamicUniforms.uMapWidth.value = mapWidth;
    this.dynamicUniforms.uMapHeight.value = mapHeight;
    this.dynamicUniforms.uRadius.value = GLOBE_RADIUS;
    this.dynamicUniforms.uProjectionType.value = this.projectionKind() === 'equirectangular' ? 0 : 1;

    const { material: terrainMat } = createPlanetMorphMaterial(
      { vertexColors: true, roughness: 0.9, metalness: 0.05 },
      this.dynamicUniforms,
    );

    this.terrainMesh = new Mesh(this.terrainGeometryData.geometry, terrainMat);
    this.terrainMesh.name = 'morph-terrain';
    this.mapWorldGroup.add(this.terrainMesh);

    // Ocean mesh (single map)
    this.oceanGeometryData = buildOceanMorphGeometry(
      GLOBE_RADIUS,
      this.heightScale(),
      this.seaLevelElevation,
      this.projectionKind(),
      MORPH_SEGMENTS,
      MORPH_RINGS,
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
    this.mapWorldGroup.add(this.oceanMesh);

    this.triangles.set(this.terrainGeometryData.triangleCount + (this.oceanGeometryData?.triangleCount ?? 0));
    this.vertices.set(this.terrainGeometryData.vertexCount + (this.oceanGeometryData?.vertexCount ?? 0));
  }

  private spawnGameUnits(): void {
    this.disposeUnits();

    // Find good cells: 3 land cells and 1 ocean cell
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

        // Base disc
        const baseGeo = new CylinderGeometry(0.08, 0.08, 0.02, 16);
        const baseMat = new MeshStandardMaterial({ color: '#22272e', roughness: 0.5, metalness: 0.8 });
        const baseMesh = new Mesh(baseGeo, baseMat);
        baseMesh.position.y = 0.01;
        group.add(baseMesh);

        // Token figure
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

        // Aura / Selection ring
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
      if (this.mapWorldGroup) {
        this.mapWorldGroup.add(group);
      } else {
        this.engine.scene.add(group);
      }

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

    // Fuselage (needle nose cone pointing along +Z)
    const bodyGeo = new ConeGeometry(0.045, 0.28, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new MeshStandardMaterial({ color: '#f8fafc', roughness: 0.2, metalness: 0.7 });
    const bodyMesh = new Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.05;
    group.add(bodyMesh);

    // Delta Wings
    const wingGeo = new BoxGeometry(0.32, 0.012, 0.12);
    const wingMat = new MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
    const wingMesh = new Mesh(wingGeo, wingMat);
    wingMesh.position.set(0, 0.048, -0.02);
    group.add(wingMesh);

    // Vertical Stabilizer / Tail
    const tailGeo = new BoxGeometry(0.012, 0.07, 0.06);
    const tailMat = new MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
    const tailMesh = new Mesh(tailGeo, tailMat);
    tailMesh.position.set(0, 0.085, -0.09);
    group.add(tailMesh);

    // Jet Thruster Glow
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
    if (!this.terrainGeometryData) return;
    const projection = MAP_PROJECTIONS[this.projectionKind()];
    const t = this.morphProgress();
    const mapWidth = this.terrainGeometryData.mapWidth;
    const mapHeight = this.terrainGeometryData.mapHeight;

    const focusedUnit = this.focusMode() === 'unit'
      ? this.units.find((u) => u.id === this.focusedUnitId())
      : undefined;
    const activeBasis = this.computeActiveProjectionBasis(focusedUnit);

    const upVector = new Vector3(0, 1, 0);

    for (const unit of this.units) {
      const transform = evaluateSurfaceTransform(
        unit.direction,
        unit.elevation,
        GLOBE_RADIUS,
        this.heightScale(),
        projection,
        mapWidth,
        mapHeight,
        t,
        activeBasis,
      );

      // Lift slightly above surface to prevent clipping
      unit.group.position.copy(transform.position).addScaledVector(transform.normal, 0.02);

      if (unit.isAir && unit.velocityDir) {
        // Forward lookahead point along velocity
        const fwdPoint: IVec3 = {
          x: unit.direction.x + unit.velocityDir.x * 0.05,
          y: unit.direction.y + unit.velocityDir.y * 0.05,
          z: unit.direction.z + unit.velocityDir.z * 0.05,
        };
        const fwdTrans = evaluateSurfaceTransform(
          fwdPoint,
          unit.elevation,
          GLOBE_RADIUS,
          this.heightScale(),
          projection,
          mapWidth,
          mapHeight,
          t,
          activeBasis,
        );
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
              // High northern circumpolar circuit between 55 deg and 68 deg North
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
              // Southern hemisphere patrol between -24 deg and -36 deg South
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
            // Ground / naval patrol logic
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

            // Move along spherical arc between cells
            if (unit.moveProgress < 1.0) {
              unit.moveProgress = Math.min(1.0, unit.moveProgress + deltaSec * 0.8);
              const p = unit.moveProgress;

              // Slerp-like direction interpolation
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

        const t = this.morphProgress();
        if (this.oceanMesh) this.oceanMesh.visible = this.showOcean();

        // Dynamic center of projection tracking
        const focused = this.focusMode() === 'unit'
          ? this.units.find((u) => u.id === this.focusedUnitId())
          : undefined;
        const activeBasis = this.computeActiveProjectionBasis(focused);

        if (activeBasis) {
          this.dynamicUniforms.uProjMode.value = 1;
          this.dynamicUniforms.uProjForward.value.set(activeBasis.forward.x, activeBasis.forward.y, activeBasis.forward.z);
          this.dynamicUniforms.uProjUp.value.set(activeBasis.up.x, activeBasis.up.y, activeBasis.up.z);
          this.dynamicUniforms.uProjRight.value.set(activeBasis.right.x, activeBasis.right.y, activeBasis.right.z);

          if (focused) {
            const latDeg = (Math.asin(Math.max(-1, Math.min(1, focused.direction.y))) * 180 / Math.PI).toFixed(1);
            const lonDeg = (Math.atan2(focused.direction.x, focused.direction.z) * 180 / Math.PI).toFixed(1);
            this.projectionCenterInfo.set({
              lonDeg: `${lonDeg}°`,
              latDeg: this.projectionTrackingMode() === 'meridian' ? '0.0° (Poles Locked)' : `${latDeg}°`,
            });
          }
        } else {
          this.dynamicUniforms.uProjMode.value = 0;
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

  private disposeMeshes(): void {
    if (this.mapWorldGroup) {
      this.engine.scene.remove(this.mapWorldGroup);
      this.mapWorldGroup.clear();
      this.mapWorldGroup = undefined;
    }
    if (this.terrainGeometryData) {
      this.terrainGeometryData.geometry.dispose();
      this.terrainGeometryData = undefined;
    }
    if (this.oceanGeometryData) {
      this.oceanGeometryData.geometry.dispose();
      this.oceanGeometryData = undefined;
    }
    this.terrainMesh = undefined;
    this.oceanMesh = undefined;
  }

  private disposeUnits(): void {
    for (const unit of this.units) {
      if (this.mapWorldGroup) {
        this.mapWorldGroup.remove(unit.group);
      } else {
        this.engine.scene.remove(unit.group);
      }
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
