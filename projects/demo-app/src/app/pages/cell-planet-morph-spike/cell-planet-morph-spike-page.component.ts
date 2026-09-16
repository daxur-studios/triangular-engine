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
  Color,
  CylinderGeometry,
  Group,
  IUniform,
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
} from './planet-morph-geometry';
import { createPlanetMorphMaterial } from './planet-morph-material';

const GLOBE_RADIUS = 2.0;
const DEFAULT_HEIGHT_SCALE = 0.16;
const MORPH_SEGMENTS = 128;
const MORPH_RINGS = 64;

interface IGameUnit {
  id: string;
  name: string;
  kind: 'scout' | 'pioneer' | 'legion' | 'frigate';
  color: string;
  currentCellId: number;
  targetCellId: number;
  direction: IVec3;
  targetDirection: IVec3;
  elevation: number;
  isNaval: boolean;
  group: Group;
  moveProgress: number;
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
  readonly focusedUnitId = signal<string>('Scout Vanguard');
  readonly availableUnits = signal<Array<{ id: string; name: string; color: string; isNaval: boolean }>>([]);

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
  private terrainMesh?: Mesh;
  private oceanMesh?: Mesh;
  private readonly morphUniform: IUniform<number> = { value: 0 };

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
    this.morphUniform.value = clamped;
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

  selectFocus(target: 'overview' | string): void {
    if (target === 'overview') {
      this.focusMode.set('overview');
    } else {
      this.focusMode.set('unit');
      this.focusedUnitId.set(target);
    }
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
        const projection = MAP_PROJECTIONS[this.projectionKind()];
        const mapWidth = this.terrainGeometryData?.mapWidth ?? 2 * Math.PI * GLOBE_RADIUS;
        const mapHeight = this.terrainGeometryData?.mapHeight ?? Math.PI * GLOBE_RADIUS;

        const transform = evaluateSurfaceTransform(
          unit.direction,
          unit.elevation,
          GLOBE_RADIUS,
          this.heightScale(),
          projection,
          mapWidth,
          mapHeight,
          t,
        );

        const target = transform.position;
        const normal = transform.normal;

        // In 3D Globe: look at the unit from outward along its surface normal
        const globeOffset = normal.clone().multiplyScalar(2.6);

        // In 2.5D Map: look at the unit from slightly south (-Y) and elevated (+Z) at a 45-deg oblique angle
        const mapOffset = new Vector3(0, -1.8, 2.4);

        const offset = new Vector3().lerpVectors(globeOffset, mapOffset, t);
        const camPos = new Vector3().addVectors(target, offset);

        this.cameraPosition.set([camPos.x, camPos.y, camPos.z]);
        this.cameraTarget.set([target.x, target.y, target.z]);
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

    const { material: terrainMat } = createPlanetMorphMaterial(
      { vertexColors: true, roughness: 0.9, metalness: 0.05 },
      { uMorph: this.morphUniform },
    );
    this.terrainMesh = new Mesh(this.terrainGeometryData.geometry, terrainMat);
    this.terrainMesh.name = 'morph-terrain';
    this.engine.scene.add(this.terrainMesh);

    // Ocean mesh
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
      { uMorph: this.morphUniform },
    );
    this.oceanMesh = new Mesh(this.oceanGeometryData.geometry, oceanMat);
    this.oceanMesh.name = 'morph-ocean';
    this.oceanMesh.visible = this.showOcean();
    this.engine.scene.add(this.oceanMesh);

    this.triangles.set(this.terrainGeometryData.triangleCount * 2);
    this.vertices.set(this.terrainGeometryData.vertexCount * 2);
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

    const configs: Array<{ name: string; kind: IGameUnit['kind']; color: string; isNaval: boolean; cellId: number }> = [
      {
        name: 'Scout Vanguard',
        kind: 'scout',
        color: '#ffcc00', // Gold
        isNaval: false,
        cellId: landCells[Math.floor(landCells.length * 0.15)] ?? 0,
      },
      {
        name: 'Pioneer Settler',
        kind: 'pioneer',
        color: '#00e5ff', // Cyan
        isNaval: false,
        cellId: landCells[Math.floor(landCells.length * 0.45)] ?? 10,
      },
      {
        name: 'Imperial Legion',
        kind: 'legion',
        color: '#ff3d71', // Crimson
        isNaval: false,
        cellId: landCells[Math.floor(landCells.length * 0.75)] ?? 20,
      },
      {
        name: 'Ironclad Frigate',
        kind: 'frigate',
        color: '#00e676', // Emerald Sea Green
        isNaval: true,
        cellId: oceanCells[Math.floor(oceanCells.length * 0.5)] ?? 30,
      },
    ];

    for (const config of configs) {
      const cell = this.graph.cells[config.cellId];
      if (!cell) continue;

      const group = new Group();
      group.name = `unit-${config.name}`;

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

      this.engine.scene.add(group);

      const elev = config.isNaval
        ? this.seaLevelElevation
        : Math.max(this.seaLevelElevation, this.sampler.sample(cell.center).elevation);

      this.units.push({
        id: config.name,
        name: config.name,
        kind: config.kind,
        color: config.color,
        currentCellId: cell.id,
        targetCellId: cell.id,
        direction: { ...cell.center },
        targetDirection: { ...cell.center },
        elevation: elev,
        isNaval: config.isNaval,
        group,
        moveProgress: 1.0,
      });
    }

    this.activeUnitsCount.set(this.units.length);
    this.availableUnits.set(
      this.units.map((u) => ({ id: u.id, name: u.name, color: u.color, isNaval: u.isNaval })),
    );
    this.updateUnitsPositions();
    this.updateCameraForProgress(this.morphProgress());
  }

  private updateUnitsPositions(): void {
    if (!this.terrainGeometryData) return;
    const projection = MAP_PROJECTIONS[this.projectionKind()];
    const t = this.morphProgress();
    const mapWidth = this.terrainGeometryData.mapWidth;
    const mapHeight = this.terrainGeometryData.mapHeight;

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
      );

      // Lift slightly above surface to prevent clipping
      unit.group.position.copy(transform.position).addScaledVector(transform.normal, 0.02);
      unit.group.quaternion.setFromUnitVectors(upVector, transform.normal);
    }
  }

  private startUnitTickLoop(): void {
    let lastTime = performance.now();

    const tick = (now: number) => {
      const deltaSec = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      if (this.autoPatrol() && this.units.length > 0) {
        for (const unit of this.units) {
          // If stationary, occasionally pick a neighbor
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
    if (this.terrainMesh) {
      this.engine.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as MeshStandardMaterial).dispose();
      this.terrainMesh = undefined;
    }
    if (this.oceanMesh) {
      this.engine.scene.remove(this.oceanMesh);
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as MeshStandardMaterial).dispose();
      this.oceanMesh = undefined;
    }
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
