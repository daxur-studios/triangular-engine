import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EngineModule,
  EngineService,
  RaycastFocusContext,
  RaycastOrbitControlsComponent,
} from 'triangular-engine';
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  CdlodPlanetComponent,
  CdlodPlaneComponent,
  CdlodCylinderComponent,
  ICdlodTelemetry,
  QualityPresetId,
  PlaneTerrainDomain,
  SphereTerrainDomain,
  CylinderTerrainDomain,
  ConstantTerrainField,
  type ITerrainFieldSample,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  ALPINE_PLANET,
  ARCHIPELAGO_PLANET,
  CANYON_PLANET,
  CRATERED_MOON,
  FAR_MOON,
  HOME_MOON,
  HOME_PLANET,
  ICelestialBody,
  createSurfaceSampler,
  createPlaneSurfaceSampler,
  createCylinderSurfaceSampler,
  ISurfaceSampler,
} from 'triangular-engine/celestial';
import {
  ScatterStreamingService,
  type ITerrainScatterInstance,
} from 'triangular-engine/scatter';
import {
  createAnimalTopologyWanderPlayback,
  type AnimalAirFlockMember,
  type AnimalAirFlockPolicyDefinition,
  type AnimalAquaticHabitatZone,
  type AnimalAquaticSchoolMember,
  type AnimalAquaticSchoolPolicyDefinition,
  type AnimalGrazingPatch,
  type AnimalLandHerdMember,
  type AnimalLandHerdPolicyDefinition,
  type AnimalRoostSite,
  type AnimalTopologyWandererDefinition,
  type AnimalVector3,
  type AnimalWaterVolume,
  type AnimalWorldSurface,
  stepAnimalAirFlock,
  stepAnimalAquaticSchool,
  stepAnimalLandHerd,
} from 'triangular-engine/animals';
import {
  TerrainAnimalWorldSurface,
} from 'triangular-engine/animals/terrain';
import { TerrainWaterAnimalVolume } from 'triangular-engine/animals/water';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
  type WaterSurface,
} from 'triangular-engine/water';
import {
  buildFloraMesh,
  FLORA_OAK_ARCHETYPE,
  FLORA_OAK_COLORS,
  generateFloraSkeleton,
} from 'triangular-engine/procedural';

export type CdlodTopology = 'sphere' | 'plane' | 'cylinder';

interface IPlanetOption {
  id: string;
  name: string;
  body: ICelestialBody;
}

interface HerdSimGroup {
  readonly wanderer: ReturnType<typeof createAnimalTopologyWanderPlayback>;
  readonly policy: AnimalLandHerdPolicyDefinition;
  readonly patches: readonly AnimalGrazingPatch[];
  readonly memberStartIndex: number;
  members: AnimalLandHerdMember[];
  readonly waypointMesh: Mesh;
}

interface BirdSimGroup {
  readonly wanderer: ReturnType<typeof createAnimalTopologyWanderPlayback>;
  readonly policy: AnimalAirFlockPolicyDefinition;
  readonly roostSites: readonly AnimalRoostSite[];
  readonly memberStartIndex: number;
  members: AnimalAirFlockMember[];
  readonly waypointMesh: Mesh;
}

interface FishSimGroup {
  readonly wanderer: ReturnType<typeof createAnimalTopologyWanderPlayback>;
  readonly policy: AnimalAquaticSchoolPolicyDefinition;
  readonly zones: readonly AnimalAquaticHabitatZone[];
  readonly memberStartIndex: number;
  members: AnimalAquaticSchoolMember[];
  readonly waypointMesh: Mesh;
}

interface TopologyLifeContext {
  readonly shape: CdlodTopology;
  readonly root: Group;
  readonly surface: AnimalWorldSurface;
  readonly water: AnimalWaterVolume;
  readonly herdGroups: readonly HerdSimGroup[];
  readonly birdGroups: readonly BirdSimGroup[];
  readonly fishGroups: readonly FishSimGroup[];
  readonly instancedTrees: InstancedMesh;
  readonly instancedHerds: InstancedMesh;
  readonly instancedBirds: InstancedMesh;
  readonly instancedFish: InstancedMesh;
  readonly debugMeadowGroup: Group;
  readonly debugRoostGroup: Group;
  readonly debugWaterGroup: Group;
  readonly debugWaypointGroup: Group;
}

@Component({
  standalone: true,
  selector: 'app-animals-terrain-world-lab-page',
  imports: [
    CommonModule,
    FormsModule,
    DecimalPipe,
    EngineModule,
    RaycastOrbitControlsComponent,
    CdlodPlanetComponent,
    CdlodPlaneComponent,
    CdlodCylinderComponent,
  ],
  templateUrl: './animals-terrain-world-lab-page.component.html',
  styleUrl: './animals-terrain-world-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ...EngineService.provide({
      showFPS: true,
      webGLRendererParameters: {
        antialias: true,
        logarithmicDepthBuffer: true,
      },
    }),
    ScatterStreamingService,
  ],
  host: { class: 'flex-page' },
})
export class AnimalsTerrainWorldLabPageComponent {
  readonly selectedShape = signal<CdlodTopology>('sphere');

  readonly planetOptions: readonly IPlanetOption[] = [
    { id: 'home-planet', name: 'Home Planet (Temperate)', body: HOME_PLANET },
    { id: 'alpine-planet', name: 'Alpine World (High Peaks)', body: ALPINE_PLANET },
    { id: 'canyon-planet', name: 'Canyon World (Arid Rifts)', body: CANYON_PLANET },
    { id: 'archipelago-planet', name: 'Archipelago (Tropical Atolls)', body: ARCHIPELAGO_PLANET },
    { id: 'cratered-moon', name: 'Cratered Moon (Basalt & Maria)', body: CRATERED_MOON },
    { id: 'home-moon', name: 'Moon (Gray)', body: HOME_MOON },
    { id: 'far-moon', name: 'Moon (Icy Cyan Plains)', body: FAR_MOON },
  ];

  readonly selectedPlanetId = signal<string>('home-planet');
  readonly selectedQuality = signal<QualityPresetId>('balanced');

  // Plane parameters
  readonly planeRootSizeM = signal<number>(4096);
  readonly planeStreamingRadius = signal<number>(4);
  readonly planeMaxLevel = signal<number>(6);
  readonly planeBaseResolution = signal<number>(32);

  // Cylinder parameters
  readonly cylinderRadiusM = signal<number>(4000);
  readonly cylinderRootSectors = signal<number>(8);
  readonly cylinderAxialRadius = signal<number>(3);
  readonly cylinderMaxLevel = signal<number>(6);

  // CDLOD feature toggles
  readonly wireframe = signal(false);
  readonly cdlodMorphing = signal(true);
  readonly featureAdaptive = signal(true);
  readonly showTerrain = signal(true);
  readonly showOcean = signal(true);
  readonly useWorkers = signal(true);
  readonly freezeLod = signal(false);

  readonly telemetry = signal<ICdlodTelemetry | null>(null);

  // Simulation controls
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly speedOptions = [-10, -5, -1, 0, 1, 5, 10] as const;

  // Scatter & Life toggles
  readonly enableScatterStreaming = signal(true);
  readonly enableLifeSimulation = signal(true);
  readonly hideTrees = signal(false);
  readonly showDebug = signal(false);
  readonly showMeadowPatches = signal(true);
  readonly showRoostSockets = signal(true);
  readonly showWaterClearance = signal(true);
  readonly showWaypoints = signal(true);

  // Telemetry counts
  readonly activeTreeCount = signal(0);
  readonly activeAnimalCount = signal(0);

  // Initial camera position focused on local terrain surface
  readonly cameraPosition = computed<[number, number, number]>(() => {
    const topo = this.selectedShape();
    if (topo === 'sphere') {
      const radius = this.selectedBody().radiusM;
      return [0, radius + 150, 300];
    }
    if (topo === 'plane') return [0, 150, 300];
    return [0, 3900, 300];
  });

  readonly cameraTarget = computed<[number, number, number]>(() => {
    const topo = this.selectedShape();
    if (topo === 'sphere') {
      const radius = this.selectedBody().radiusM;
      return [0, radius, 0];
    }
    if (topo === 'plane') return [0, 0, 0];
    return [0, 4000, 0];
  });

  readonly terrainRaycastFocus = (context: RaycastFocusContext): Vector3 | null => {
    const hits = context.raycaster.intersectObjects(
      context.sceneChildren as unknown as import('three').Object3D[],
      true,
    );
    if (hits.length > 0) return hits[0].point;
    return null;
  };

  readonly selectedBody = computed<ICelestialBody>(() => {
    const id = this.selectedPlanetId();
    return this.planetOptions.find(p => p.id === id)?.body ?? HOME_PLANET;
  });

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scatterStreamer = inject(ScatterStreamingService);

  // High-visibility models
  private readonly animalGeometry = new SphereGeometry(4.0, 14, 10);
  private readonly animalMaterial = new MeshStandardMaterial({ color: '#f59e0b', roughness: 0.45 });

  private readonly birdGeometry = createBirdGeometry();
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#fef08a', roughness: 0.35, side: DoubleSide });

  private readonly fishGeometry = createFishGeometry();
  private readonly fishMaterial = new MeshStandardMaterial({ color: '#fb923c', roughness: 0.25, side: DoubleSide });

  private readonly treeGeometry: BufferGeometry;
  private readonly treeMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });

  private contexts: Record<CdlodTopology, TopologyLifeContext> | null = null;
  private readonly tempMatrix = new Matrix4();

  constructor() {
    // Generate Tree Mesh Archetype with foliage vertex colors
    const skeleton = generateFloraSkeleton(FLORA_OAK_ARCHETYPE, 777);
    const { geometry } = buildFloraMesh(skeleton, FLORA_OAK_ARCHETYPE);
    colorizeTree(geometry);
    this.treeGeometry = geometry;

    // Initialize contexts for the active body
    this.rebuildContexts();

    // Simulation & Scatter Streaming Loop
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!this.paused() && this.timeScale() !== 0) {
        const simDt = dt * this.timeScale();
        this.universalTime.update(t => t + simDt);
        this.stepSimulation(this.universalTime(), Math.abs(simDt));
      }
    }, 40);

    // Re-stream scatter when camera moves
    this.scatterStreamer.viewpointWorldM$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateScatterStreaming();
      });

    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      if (this.contexts) {
        for (const ctx of Object.values(this.contexts)) {
          ctx.root.removeFromParent();
        }
      }
      this.animalGeometry.dispose();
      this.animalMaterial.dispose();
      this.birdGeometry.dispose();
      this.birdMaterial.dispose();
      this.fishGeometry.dispose();
      this.fishMaterial.dispose();
      this.treeGeometry.dispose();
      this.treeMaterial.dispose();
    });
  }

  setShape(shape: CdlodTopology): void {
    this.selectedShape.set(shape);
    this.rebuildContexts();
  }

  onSelectPlanet(planetId: string): void {
    this.selectedPlanetId.set(planetId);
    this.rebuildContexts();
  }

  onTelemetry(event: ICdlodTelemetry): void {
    this.telemetry.set(event);
  }

  setUniversalTime(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.universalTime.set(value);
      this.resetGroupPositions(value);
      this.stepSimulation(value, 0.05);
    }
  }

  setTimeScale(value: number): void {
    this.timeScale.set(value);
    this.paused.set(value === 0);
  }

  togglePause(): void {
    this.paused.update(v => !v);
  }

  toggleScatterStreaming(): void {
    this.enableScatterStreaming.update(v => !v);
    this.updateScatterStreaming();
  }

  toggleLifeSimulation(): void {
    this.enableLifeSimulation.update(v => !v);
    this.updateViewPresentation();
  }

  toggleHideTrees(): void {
    this.hideTrees.update(v => !v);
    this.updateViewPresentation();
  }

  toggleDebug(): void {
    this.showDebug.update(v => !v);
    this.updateViewPresentation();
  }

  toggleMeadowPatches(): void {
    this.showMeadowPatches.update(v => !v);
    this.updateViewPresentation();
  }

  toggleRoostSockets(): void {
    this.showRoostSockets.update(v => !v);
    this.updateViewPresentation();
  }

  toggleWaterClearance(): void {
    this.showWaterClearance.update(v => !v);
    this.updateViewPresentation();
  }

  toggleWaypoints(): void {
    this.showWaypoints.update(v => !v);
    this.updateViewPresentation();
  }

  reset(): void {
    this.universalTime.set(0);
    this.timeScale.set(1);
    this.paused.set(false);
    this.resetGroupPositions(0);
    this.stepSimulation(0, 0.05);
  }

  private rebuildContexts(): void {
    if (this.contexts) {
      for (const ctx of Object.values(this.contexts)) {
        ctx.root.removeFromParent();
      }
    }

    const body = this.selectedBody();
    this.contexts = {
      sphere: this.buildTopologyLifeContext('sphere', body),
      plane: this.buildTopologyLifeContext('plane', body),
      cylinder: this.buildTopologyLifeContext('cylinder', body),
    };

    for (const ctx of Object.values(this.contexts)) {
      this.engine.scene.add(ctx.root);
    }

    this.updateViewPresentation();
    this.updateScatterStreaming();
    this.resetGroupPositions(0);
    this.stepSimulation(0, 0.05);
  }

  private updateViewPresentation(): void {
    if (!this.contexts) return;
    const activeShape = this.selectedShape();
    const isDebug = this.showDebug();
    const hideTreeFoliage = isDebug && this.hideTrees();
    const lifeEnabled = this.enableLifeSimulation();
    const scatterEnabled = this.enableScatterStreaming();

    for (const [shape, ctx] of Object.entries(this.contexts) as [CdlodTopology, TopologyLifeContext][]) {
      const active = shape === activeShape;
      ctx.root.visible = active;
      if (active) {
        ctx.instancedTrees.visible = scatterEnabled && !hideTreeFoliage;
        ctx.instancedHerds.visible = lifeEnabled;
        ctx.instancedBirds.visible = lifeEnabled;
        ctx.instancedFish.visible = lifeEnabled;
        ctx.debugMeadowGroup.visible = isDebug && this.showMeadowPatches();
        ctx.debugRoostGroup.visible = isDebug && this.showRoostSockets();
        ctx.debugWaterGroup.visible = isDebug && this.showWaterClearance();
        ctx.debugWaypointGroup.visible = isDebug && this.showWaypoints();
      }
    }
  }

  /**
   * Generates procedural tree scatter instances anchored to fixed world grid cells
   * so trees remain 100% stationary on the terrain as the camera moves.
   */
  private updateScatterStreaming(): void {
    if (!this.contexts) return;
    const activeShape = this.selectedShape();
    const ctx = this.contexts[activeShape];
    const body = this.selectedBody();

    if (!this.enableScatterStreaming()) {
      ctx.instancedTrees.count = 0;
      ctx.instancedTrees.instanceMatrix.needsUpdate = true;
      this.activeTreeCount.set(0);
      return;
    }

    const camPos = this.engine.camera ? this.engine.camera.position : new Vector3(0, 200, 400);
    const cellSizeM = 150;
    const gridRadiusCells = 7; // 15x15 grid of fixed world cells around camera
    const centerCellX = Math.round(camPos.x / cellSizeM);
    const centerCellZ = Math.round(camPos.z / cellSizeM);
    const maxInstances = 256;
    const treeInstances: ITerrainScatterInstance[] = [];

    for (let dx = -gridRadiusCells; dx <= gridRadiusCells; dx++) {
      for (let dz = -gridRadiusCells; dz <= gridRadiusCells; dz++) {
        if (treeInstances.length >= maxInstances) break;
        const cx = centerCellX + dx;
        const cz = centerCellZ + dz;

        // Deterministic hash based exclusively on cell coordinates (cx, cz)
        const hash = Math.abs(Math.sin(cx * 127.1 + cz * 311.7) * 43758.5453) % 1;
        if (hash > 0.45) continue; // Placement density

        const offsetX = ((hash * 1000) % 1 - 0.5) * (cellSizeM * 0.75);
        const offsetZ = ((hash * 7919) % 1 - 0.5) * (cellSizeM * 0.75);
        const wx = cx * cellSizeM + offsetX;
        const wz = cz * cellSizeM + offsetZ;

        const samplePos = activeShape === 'sphere'
          ? { x: wx, y: body.radiusM, z: wz }
          : activeShape === 'cylinder'
            ? { x: wx, y: 3950, z: wz }
            : { x: wx, y: 0, z: wz };

        const frame = ctx.surface.sample(samplePos);
        // Only place trees on walkable land above sea level
        if (frame.walkable && frame.elevationM > 1.0) {
          treeInstances.push({
            instanceId: `cell-${cx}-${cz}` as any,
            worldPositionM: [frame.position.x, frame.position.y, frame.position.z],
            normal: [frame.normal.x, frame.normal.y, frame.normal.z],
            surfaceUp: [frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z],
            rotationSeed01: hash,
            scaleSeed01: 0.8 + ((hash * 13) % 1) * 0.4,
            embedSeed01: 0,
          });
        }
      }
    }

    const treeQuat = new Quaternion();
    const treeMat = new Matrix4();
    const treeScale = new Vector3(4.0, 4.0, 4.0);

    ctx.instancedTrees.count = treeInstances.length;
    treeInstances.forEach((inst, idx) => {
      treeQuat.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(inst.surfaceUp[0], inst.surfaceUp[1], inst.surfaceUp[2]),
      );
      treeMat.compose(
        new Vector3(inst.worldPositionM[0], inst.worldPositionM[1], inst.worldPositionM[2]),
        treeQuat,
        treeScale,
      );
      ctx.instancedTrees.setMatrixAt(idx, treeMat);
    });

    ctx.instancedTrees.instanceMatrix.needsUpdate = true;
    this.activeTreeCount.set(treeInstances.length);
  }

  private buildTopologyLifeContext(shape: CdlodTopology, body: ICelestialBody): TopologyLifeContext {
    const sampler = shape === 'sphere'
      ? createSurfaceSampler(body)
      : shape === 'plane'
        ? createPlaneSurfaceSampler(body)
        : createCylinderSurfaceSampler(body, 4000);

    const field = new CelestialTerrainField(sampler, shape);
    const domain = shape === 'sphere'
      ? new SphereTerrainDomain(body.radiusM)
      : shape === 'plane'
        ? new PlaneTerrainDomain(4096)
        : new CylinderTerrainDomain({ radiusM: 4000, lengthM: 8000 });

    const surface = new TerrainAnimalWorldSurface(field, domain, { maxWalkableSlope01: 0.75 });
    const water = this.makeWaterVolume(shape, body.radiusM, surface);

    const root = new Group();
    const debugMeadowGroup = new Group();
    const debugRoostGroup = new Group();
    const debugWaterGroup = new Group();
    const debugWaypointGroup = new Group();
    root.add(debugMeadowGroup, debugRoostGroup, debugWaterGroup, debugWaypointGroup);

    // Pre-allocated Instanced Batches (frustumCulled = false to prevent bounding box drops)
    const maxStreamedTrees = 256;
    const instancedTrees = new InstancedMesh(this.treeGeometry, this.treeMaterial, maxStreamedTrees);
    instancedTrees.count = 0;
    instancedTrees.frustumCulled = false;
    root.add(instancedTrees);

    // Generate candidate positions centered around the initial viewport / North Pole
    const candidatePositions: AnimalVector3[] = [];
    const sampleCount = 140;
    const localRadiusM = 2200;

    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * Math.PI * 2;
      const dist = 60 + Math.sqrt((i + 1) / sampleCount) * localRadiusM;
      const px = Math.cos(angle) * dist;
      const pz = Math.sin(angle) * dist;

      if (shape === 'sphere') {
        candidatePositions.push({ x: px, y: body.radiusM, z: pz });
      } else if (shape === 'cylinder') {
        candidatePositions.push({ x: px, y: 3950, z: pz });
      } else {
        candidatePositions.push({ x: px, y: 0, z: pz });
      }
    }

    const landBiomePositions: AnimalVector3[] = [];
    const waterBiomePositions: AnimalVector3[] = [];

    for (const pos of candidatePositions) {
      const surfSample = surface.sample(pos);
      if (surfSample.elevationM < 0) {
        waterBiomePositions.push(surfSample.position);
      } else {
        landBiomePositions.push(surfSample.position);
      }
    }

    // Guarantees diverse locations even if planet has extreme topography
    if (landBiomePositions.length < 12) {
      for (const pos of candidatePositions) landBiomePositions.push(surface.sample(pos).position);
    }
    if (waterBiomePositions.length < 8) {
      for (const pos of candidatePositions) {
        const frame = surface.sample(pos);
        waterBiomePositions.push(add(frame.position, scale(frame.surfaceUp, -5.0)));
      }
    }

    // 1. Grazing Meadows
    const targetMeadowCount = 12;
    const meadowPositions = filterWithMinDistance(landBiomePositions, 180, targetMeadowCount);
    const grazingPatches: AnimalGrazingPatch[] = meadowPositions.map((pos, index) => {
      const frame = surface.sample(pos);
      return {
        id: `${shape}-meadow-${index}`,
        position: frame.position,
        radiusM: 40 + (index % 2) * 15,
        capacity: 10,
        suitability01: 0.9,
      };
    });

    for (const patch of grazingPatches) {
      const frame = surface.sample(patch.position);
      const ring = new Mesh(
        new RingGeometry(patch.radiusM - 2, patch.radiusM, 24),
        new MeshBasicMaterial({ color: '#70e000', side: DoubleSide, transparent: true, opacity: 0.75 }),
      );
      ring.position.set(frame.position.x, frame.position.y, frame.position.z);
      ring.quaternion.copy(new Quaternion().setFromUnitVectors(
        new Vector3(0, 0, 1),
        new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z),
      ));
      debugMeadowGroup.add(ring);
    }

    // 2. Tree Canopy Roost Sites
    const birdRoostSites: AnimalRoostSite[] = grazingPatches.map((patch, index) => {
      const frame = surface.sample(patch.position);
      const perchPos = add(patch.position, scale(frame.surfaceUp, 35.0));
      return {
        id: `${shape}-roost-${index}`,
        position: perchPos,
        capacity: 4,
      };
    });

    // 3. Underwater Feeding Reefs
    const targetReefCount = 8;
    const reefPositions = filterWithMinDistance(waterBiomePositions, 160, targetReefCount);
    const fishZones: AnimalAquaticHabitatZone[] = reefPositions.map((pos, index) => {
      const frame = surface.sample(pos);
      const waterDepth = Math.max(5.0, -frame.elevationM);
      const cruiseOffset = frame.elevationM + waterDepth * 0.5;
      const reefPos = add(frame.position, scale(frame.surfaceUp, cruiseOffset));
      const zoneRadius = Math.min(35, Math.max(12, waterDepth * 1.5));

      const volumeCylinder = new Mesh(
        new CylinderGeometry(zoneRadius, zoneRadius, Math.max(6, waterDepth * 0.8), 16, 1, true),
        new MeshBasicMaterial({ color: '#00f5d4', side: DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      volumeCylinder.position.set(reefPos.x, reefPos.y, reefPos.z);
      volumeCylinder.quaternion.copy(new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z),
      ));
      debugWaterGroup.add(volumeCylinder);

      return {
        id: `${shape}-reef-${index}`,
        position: reefPos,
        radiusM: zoneRadius,
        capacity: 10,
        suitability01: 0.95,
      };
    });

    // 4. Land Herd Groups
    const herdGroupCount = 4;
    const membersPerHerd = 5;
    const totalHerdMembers = herdGroupCount * membersPerHerd;
    const instancedHerds = new InstancedMesh(this.animalGeometry, this.animalMaterial, Math.max(1, totalHerdMembers));
    instancedHerds.count = totalHerdMembers;
    instancedHerds.frustumCulled = false;
    root.add(instancedHerds);

    const herdGroups: HerdSimGroup[] = Array.from({ length: herdGroupCount }, (_, groupIdx) => {
      const memberCount = membersPerHerd;
      const count = Math.min(4, Math.max(1, grazingPatches.length));
      const startIdx = (groupIdx * 2) % grazingPatches.length;
      const sectorPatches = deduplicateById(
        Array.from({ length: count }, (__, i) => grazingPatches[(startIdx + i) % grazingPatches.length]),
      );

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-herd-${groupIdx}`,
        groupSeed: 0x7101 + groupIdx * 41,
        habitats: sectorPatches.map(p => ({ id: p.id, position: p.position, radiusM: p.radiusM })),
        surface,
        travelSpeedMps: 22.0,
        minDwellDurationS: 8,
        maxDwellDurationS: 16,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalLandHerdPolicyDefinition = {
        surface,
        maximumMembers: 32,
        maximumPatches: Math.max(64, sectorPatches.length + 10),
        maximumSpeedMps: 26.0,
        maximumAccelerationMps2: 15.0,
        maximumSubstepDistanceM: 5.0,
        maximumSubsteps: 8,
        maximumSlope01: 0.75,
        maximumPatchDistanceM: 5000,
        minimumPatchSuitability01: 0.5,
        separationRadiusM: 8.0,
        separationWeight: 1.5,
        cohesionWeight: 0.6,
        alignmentWeight: 0.5,
        targetWeight: 1.0,
        arrivalRadiusM: 12.0,
        slotSpacingM: 6.0,
        maximumAvoidanceAttempts: 4,
      };

      const homePos = sectorPatches[0].position;
      const members: AnimalLandHerdMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        const offset = surface.moveAlongSurface(homePos, { x: (memIdx - 2) * 5.0, y: 0, z: (memIdx % 2) * 4.0 }, 1);
        return {
          id: `herd-${groupIdx}-mem-${memIdx}`,
          position: offset,
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'graze' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(8.0),
        new MeshBasicMaterial({ color: '#ff5400', wireframe: true }),
      );
      debugWaypointGroup.add(waypointMesh);

      return {
        wanderer, policy, patches: sectorPatches,
        memberStartIndex: groupIdx * membersPerHerd,
        members, waypointMesh,
      };
    });

    // 5. Bird Flock Groups
    const birdGroupCount = 4;
    const membersPerBirdFlock = 5;
    const totalBirdMembers = birdGroupCount * membersPerBirdFlock;
    const instancedBirds = new InstancedMesh(this.birdGeometry, this.birdMaterial, Math.max(1, totalBirdMembers));
    instancedBirds.count = totalBirdMembers;
    instancedBirds.frustumCulled = false;
    root.add(instancedBirds);

    const birdGroups: BirdSimGroup[] = Array.from({ length: birdGroupCount }, (_, groupIdx) => {
      const memberCount = membersPerBirdFlock;
      const roostCount = Math.min(4, Math.max(1, birdRoostSites.length));
      const startIdx = (groupIdx * 2) % Math.max(1, birdRoostSites.length);
      const sectorRoosts = birdRoostSites.length > 0
        ? deduplicateById(
          Array.from({ length: roostCount }, (__, i) => birdRoostSites[(startIdx + i) % birdRoostSites.length]),
        )
        : [];

      const wanderHabitats = sectorRoosts.length > 0
        ? sectorRoosts.map(r => ({ id: r.id, position: r.position, radiusM: 35 }))
        : [{ id: 'sky-base', position: add(landBiomePositions[0], { x: 0, y: 50, z: 0 }), radiusM: 45 }];

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-birds-${groupIdx}`,
        groupSeed: 0x3344 + groupIdx * 29,
        habitats: wanderHabitats,
        surface,
        travelSpeedMps: 48.0,
        minDwellDurationS: 6,
        maxDwellDurationS: 12,
        travelArcHeightM: 45.0,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalAirFlockPolicyDefinition = {
        surface,
        maximumMembers: 32,
        maximumRoostSites: Math.max(64, sectorRoosts.length + 10),
        maximumSpeedMps: 60.0,
        maximumAccelerationMps2: 32.0,
        maximumSubstepDistanceM: 8.0,
        maximumSubsteps: 8,
        minimumAltitudeM: 10.0,
        maximumAltitudeM: 140.0,
        preferredAltitudeM: 45.0,
        flightBehavior: 'boid3d',
        flightAltitudeSpreadM: 15.0,
        separationRadiusM: 12.0,
        separationWeight: 1.5,
        cohesionWeight: 0.8,
        alignmentWeight: 1.0,
        targetWeight: 1.2,
        arrivalRadiusM: 15.0,
        holdingRadiusM: 40.0,
        holdingSpeedMps: 24.0,
        roostSlotSpacingM: 8.0,
      };

      const homePos = wanderHabitats[0].position;
      const members: AnimalAirFlockMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        const frame = surface.sample(homePos);
        const altPos = add(homePos, scale(frame.surfaceUp, 40.0));
        return {
          id: `bird-${groupIdx}-mem-${memIdx}`,
          position: add(altPos, { x: (memIdx - 2) * 10.0, y: 0, z: (memIdx % 2) * 10.0 }),
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'holding' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(8.0),
        new MeshBasicMaterial({ color: '#f72585', wireframe: true }),
      );
      debugWaypointGroup.add(waypointMesh);

      return {
        wanderer, policy, roostSites: sectorRoosts,
        memberStartIndex: groupIdx * membersPerBirdFlock,
        members, waypointMesh,
      };
    });

    // 6. Fish School Groups
    const fishGroupCount = 3;
    const membersPerFishSchool = 5;
    const totalFishMembers = fishGroupCount * membersPerFishSchool;
    const instancedFish = new InstancedMesh(this.fishGeometry, this.fishMaterial, Math.max(1, totalFishMembers));
    instancedFish.count = totalFishMembers;
    instancedFish.frustumCulled = false;
    root.add(instancedFish);

    const fishGroups: FishSimGroup[] = Array.from({ length: fishGroupCount }, (_, groupIdx) => {
      const memberCount = membersPerFishSchool;
      const zoneCount = Math.min(3, Math.max(1, fishZones.length));
      const startIdx = (groupIdx * 2) % Math.max(1, fishZones.length);
      const sectorZones = deduplicateById(
        Array.from({ length: zoneCount }, (__, i) => fishZones[(startIdx + i) % fishZones.length]),
      );

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-fish-${groupIdx}`,
        groupSeed: 0x9922 + groupIdx * 17,
        habitats: sectorZones.map(p => ({ id: p.id, position: p.position, radiusM: p.radiusM })),
        surface,
        travelSpeedMps: 18.0,
        minDwellDurationS: 7,
        maxDwellDurationS: 14,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalAquaticSchoolPolicyDefinition = {
        water,
        maximumMembers: 32,
        maximumZones: Math.max(32, sectorZones.length + 10),
        maximumZoneDistanceM: 5000,
        minimumZoneSuitability01: 0.5,
        maximumSpeedMps: 22.0,
        maximumAccelerationMps2: 15.0,
        maximumSubstepDistanceM: 5.0,
        maximumSubsteps: 8,
        minimumSurfaceClearanceM: 1.0,
        minimumBottomClearanceM: 1.0,
        preferredSurfaceClearanceM: 3.5,
        maximumSurfaceClearanceM: 40.0,
        segmentSampleSpacingM: 3.0,
        separationRadiusM: 6.0,
        separationWeight: 1.4,
        cohesionWeight: 0.8,
        alignmentWeight: 0.9,
        targetWeight: 1.1,
        flowWeight: 0.2,
        depthWeight: 0.7,
        arrivalRadiusM: 10.0,
        slotSpacingM: 4.0,
        loiterRadiusM: 8.0,
        loiterAngularSpeedRadPerSecond: 0.6,
        maximumAvoidanceAttempts: 4,
      };

      const homePos = sectorZones[0].position;
      const members: AnimalAquaticSchoolMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        return {
          id: `fish-${groupIdx}-mem-${memIdx}`,
          position: add(homePos, { x: (memIdx - 2) * 4.0, y: 0, z: (memIdx % 2) * 4.0 }),
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'forage' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(8.0),
        new MeshBasicMaterial({ color: '#4cc9f0', wireframe: true }),
      );
      debugWaypointGroup.add(waypointMesh);

      return {
        wanderer, policy, zones: sectorZones,
        memberStartIndex: groupIdx * membersPerFishSchool,
        members, waypointMesh,
      };
    });

    return {
      shape, root, surface, water,
      herdGroups, birdGroups, fishGroups,
      instancedTrees, instancedHerds, instancedBirds, instancedFish,
      debugMeadowGroup, debugRoostGroup, debugWaterGroup, debugWaypointGroup,
    };
  }

  private makeWaterVolume(shape: CdlodTopology, radiusM: number, terrainSurface: AnimalWorldSurface): AnimalWaterVolume {
    const surface: WaterSurface = {
      getHeight: () => 0,
      getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
      getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.15, 0, 0.05),
    };
    const domain = shape === 'plane'
      ? new PlaneWaterDomain()
      : shape === 'sphere'
        ? new SphereWaterDomain(radiusM)
        : new CylinderWaterDomain(4000, { axis: new Vector3(1, 0, 0), lengthM: 8000 });

    return new TerrainWaterAnimalVolume({
      terrain: terrainSurface,
      bodies: [{ body: { id: `${shape}-water`, domain, surface } }],
    });
  }

  private resetGroupPositions(universalTime: number): void {
    if (!this.contexts) return;
    for (const ctx of Object.values(this.contexts)) {
      for (const herd of ctx.herdGroups) {
        const snap = herd.wanderer.sample(universalTime);
        const center = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
        herd.members = herd.members.map((m, idx) => ({
          ...m,
          position: ctx.surface.moveAlongSurface(center, { x: (idx - 2) * 5.0, y: 0, z: (idx % 2) * 4.0 }, 1),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
      for (const bird of ctx.birdGroups) {
        const snap = bird.wanderer.sample(universalTime);
        const frame = ctx.surface.sample(snap.position);
        const center = add(snap.position, scale(frame.surfaceUp, 40.0));
        bird.members = bird.members.map((m, idx) => ({
          ...m,
          position: add(center, { x: (idx - 2) * 10.0, y: 0, z: (idx % 2) * 10.0 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
      for (const fish of ctx.fishGroups) {
        const snap = fish.wanderer.sample(universalTime);
        const center = snap.currentHabitat.position;
        fish.members = fish.members.map((m, idx) => ({
          ...m,
          position: add(center, { x: (idx - 2) * 4.0, y: 0, z: (idx % 2) * 4.0 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
    }
  }

  private stepSimulation(universalTime: number, deltaSeconds: number): void {
    if (!this.contexts) return;
    const activeShape = this.selectedShape();
    const ctx = this.contexts[activeShape];

    if (!this.enableLifeSimulation()) {
      ctx.instancedHerds.count = 0;
      ctx.instancedHerds.instanceMatrix.needsUpdate = true;
      ctx.instancedBirds.count = 0;
      ctx.instancedBirds.instanceMatrix.needsUpdate = true;
      ctx.instancedFish.count = 0;
      ctx.instancedFish.instanceMatrix.needsUpdate = true;
      this.activeAnimalCount.set(0);
      return;
    }

    let totalRenderedAnimals = 0;

    // 1. Step Land Herds
    for (const group of ctx.herdGroups) {
      const snap = group.wanderer.sample(universalTime);
      const target = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
      const intent = snap.activity === 'travel' ? 'travel' as const : 'graze' as const;

      group.waypointMesh.position.set(target.x, target.y + 4.0, target.z);
      totalRenderedAnimals += group.members.length;

      const firstMemDist = Math.hypot(
        group.members[0].position.x - target.x,
        group.members[0].position.y - target.y,
        group.members[0].position.z - target.z,
      );
      if (firstMemDist > 120.0) {
        group.members = group.members.map((m, idx) => ({
          ...m,
          position: ctx.surface.moveAlongSurface(target, { x: (idx - 2) * 5.0, y: 0, z: (idx % 2) * 4.0 }, 1),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }

      const result = stepAnimalLandHerd({
        members: group.members,
        target,
        intent,
        universalTime,
        deltaSeconds,
        patches: group.patches,
      }, group.policy);

      group.members = [...result.members];
      this.writeHerdInstances(ctx, group);
    }
    ctx.instancedHerds.instanceMatrix.needsUpdate = true;

    // 2. Step Bird Flocks
    for (const group of ctx.birdGroups) {
      const snap = group.wanderer.sample(universalTime);
      const target = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
      const intent = snap.activity === 'travel' ? 'fly' as const : 'roost' as const;

      group.waypointMesh.position.set(target.x, target.y, target.z);
      totalRenderedAnimals += group.members.length;

      const firstMemDist = Math.hypot(
        group.members[0].position.x - target.x,
        group.members[0].position.y - target.y,
        group.members[0].position.z - target.z,
      );
      if (firstMemDist > 150.0) {
        const frame = ctx.surface.sample(target);
        const altPos = add(target, scale(frame.surfaceUp, 40.0));
        group.members = group.members.map((m, idx) => ({
          ...m,
          position: add(altPos, { x: (idx - 2) * 10.0, y: 0, z: (idx % 2) * 10.0 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }

      const result = stepAnimalAirFlock({
        members: group.members,
        target,
        intent,
        universalTime,
        deltaSeconds,
        roostSites: group.roostSites,
      }, group.policy);

      group.members = [...result.members];
      this.writeBirdInstances(ctx, group);
    }
    ctx.instancedBirds.instanceMatrix.needsUpdate = true;

    // 3. Step Fish Schools
    for (const group of ctx.fishGroups) {
      const snap = group.wanderer.sample(universalTime);
      const target = snap.currentHabitat.position;
      const intent = snap.activity === 'travel' ? 'travel' as const : 'forage' as const;

      group.waypointMesh.position.set(target.x, target.y, target.z);
      totalRenderedAnimals += group.members.length;

      const firstMemDist = Math.hypot(
        group.members[0].position.x - target.x,
        group.members[0].position.y - target.y,
        group.members[0].position.z - target.z,
      );
      if (firstMemDist > 100.0) {
        group.members = group.members.map((m, idx) => ({
          ...m,
          position: add(target, { x: (idx - 2) * 4.0, y: 0, z: (idx % 2) * 4.0 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }

      const result = stepAnimalAquaticSchool({
        members: group.members,
        target,
        intent,
        universalTime,
        deltaSeconds,
        zones: group.zones,
      }, group.policy);

      group.members = [...result.members];
      this.writeFishInstances(ctx, group);
    }
    ctx.instancedFish.instanceMatrix.needsUpdate = true;

    this.activeAnimalCount.set(totalRenderedAnimals);
  }

  private writeHerdInstances(ctx: TopologyLifeContext, group: HerdSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const frame = ctx.surface.sample(member.position);
      const pos = new Vector3(
        frame.position.x + frame.surfaceUp.x * 4.0,
        frame.position.y + frame.surfaceUp.y * 4.0,
        frame.position.z + frame.surfaceUp.z * 4.0,
      );

      const up = new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).normalize();
      const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
      const rot = new Matrix4();

      if (vel.lengthSq() > 0.01) {
        const fwd = vel.clone().normalize();
        const right = new Vector3().crossVectors(up, fwd).normalize();
        const correctedFwd = new Vector3().crossVectors(right, up).normalize();
        rot.makeBasis(right, up, correctedFwd);
      } else {
        const right = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();
        const fwd = new Vector3(frame.tangentV.x, frame.tangentV.y, frame.tangentV.z).normalize();
        rot.makeBasis(right, up, fwd);
      }

      this.tempMatrix.makeTranslation(pos.x, pos.y, pos.z).multiply(rot);
      ctx.instancedHerds.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }

  private writeBirdInstances(ctx: TopologyLifeContext, group: BirdSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
      const frame = ctx.surface.sample(member.position);
      const surfaceUp = new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).normalize();
      const rot = new Matrix4();

      if (vel.lengthSq() > 0.04) {
        const fwd = vel.clone().normalize();
        let right = new Vector3().crossVectors(surfaceUp, fwd).normalize();
        if (right.lengthSq() < 0.01) {
          const ref = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();
          right = new Vector3().crossVectors(ref, fwd).normalize();
        }
        const up = new Vector3().crossVectors(fwd, right).normalize();
        rot.makeBasis(right, up, fwd);
      } else {
        const fwd = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();
        const right = new Vector3().crossVectors(surfaceUp, fwd).normalize();
        rot.makeBasis(right, surfaceUp, fwd);
      }

      this.tempMatrix.makeTranslation(member.position.x, member.position.y, member.position.z).multiply(rot);
      ctx.instancedBirds.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }

  private writeFishInstances(ctx: TopologyLifeContext, group: FishSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
      const frame = ctx.surface.sample(member.position);
      const surfaceUp = new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).normalize();
      const rot = new Matrix4();

      if (vel.lengthSq() > 0.01) {
        const fwd = vel.clone().normalize();
        let right = new Vector3().crossVectors(surfaceUp, fwd).normalize();
        if (right.lengthSq() < 0.01) {
          const ref = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();
          right = new Vector3().crossVectors(ref, fwd).normalize();
        }
        const up = new Vector3().crossVectors(fwd, right).normalize();
        rot.makeBasis(right, up, fwd);
      } else {
        const fwd = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();
        const right = new Vector3().crossVectors(surfaceUp, fwd).normalize();
        rot.makeBasis(right, surfaceUp, fwd);
      }

      this.tempMatrix.makeTranslation(member.position.x, member.position.y, member.position.z).multiply(rot);
      ctx.instancedFish.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }
}

/**
 * Connects the celestial body procedural surface samplers to ITerrainField.
 */
class CelestialTerrainField extends ConstantTerrainField {
  constructor(private readonly sampler: ISurfaceSampler, private readonly shape: CdlodTopology) {
    super(0);
  }

  override sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    if (this.shape === 'sphere') {
      const len = Math.hypot(x, y, z) || 1;
      const sample = this.sampler.sample([x / len, y / len, z / len]);
      return { elevationM: sample.elevationM };
    }
    if (this.shape === 'plane') {
      const sample = this.sampler.sample([x, 0, z]);
      return { elevationM: sample.elevationM };
    }
    // cylinder
    const sample = this.sampler.sample([x, y, z]);
    return { elevationM: sample.elevationM };
  }
}

function scale(value: AnimalVector3, factor: number): AnimalVector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function add(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function colorizeTree(geometry: BufferGeometry): void {
  const weights = geometry.getAttribute('windWeight');
  if (!weights) return;
  const colors = new Float32Array(weights.count * 3);
  const trunk = new Color(FLORA_OAK_COLORS.trunkHex);
  const leaves = new Color(FLORA_OAK_COLORS.leafHex);
  const color = new Color();
  for (let index = 0; index < weights.count; index++) {
    color.copy(trunk).lerp(leaves, weights.getX(index));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function deduplicateById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

function filterWithMinDistance(positions: readonly AnimalVector3[], minDistanceM: number, maxCount: number): AnimalVector3[] {
  const result: AnimalVector3[] = [];
  const minSq = minDistanceM * minDistanceM;
  for (const pos of positions) {
    let tooClose = false;
    for (const chosen of result) {
      const dx = pos.x - chosen.x;
      const dy = pos.y - chosen.y;
      const dz = pos.z - chosen.z;
      if (dx * dx + dy * dy + dz * dz < minSq) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      result.push(pos);
      if (result.length >= maxCount) break;
    }
  }
  return result;
}

function createBirdGeometry(): BufferGeometry {
  const geom = new BufferGeometry();
  const vertices = new Float32Array([
    // Beak Top
    0, 0.6, 6.0,    0, 2.0, 2.0,   -1.5, 0.8, 2.0,
    0, 0.6, 6.0,    1.5, 0.8, 2.0,  0, 2.0, 2.0,
    // Beak Bottom
    0, 0.6, 6.0,   -1.5, 0.8, 2.0,  0, -1.2, 1.5,
    0, 0.6, 6.0,    0, -1.2, 1.5,   1.5, 0.8, 2.0,
    // Left Wing
    0, 2.0, 2.0,   -12.0, 1.5, -1.0, 0, 1.2, -2.8,
    -1.5, 0.8, 2.0, -12.0, 1.5, -1.0, 0, -1.2, 1.5,
    // Right Wing
    0, 2.0, 2.0,    0, 1.2, -2.8,   12.0, 1.5, -1.0,
    1.5, 0.8, 2.0,  0, -1.2, 1.5,   12.0, 1.5, -1.0,
    // Tail
    0, 1.2, -2.8,  -3.0, 1.0, -6.0, 3.0, 1.0, -6.0,
    0, 1.2, -2.8,   3.0, 1.0, -6.0, 0, -1.2, 1.5,
    0, 1.2, -2.8,   0, -1.2, 1.5,  -3.0, 1.0, -6.0,
  ]);
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}

function createFishGeometry(): BufferGeometry {
  const geom = new BufferGeometry();
  const vertices = new Float32Array([
    // Snout / Head Left
    0, 0.4, 6.0,   -2.2, 0.5, 1.0,  0, 3.0, -1.0,
    0, 0.4, 6.0,    0, -2.0, 0.0,   -2.2, 0.5, 1.0,
    // Snout / Head Right
    0, 0.4, 6.0,    0, 3.0, -1.0,    2.2, 0.5, 1.0,
    0, 0.4, 6.0,    2.2, 0.5, 1.0,  0, -2.0, 0.0,
    // Body to Tail Left
    -2.2, 0.5, 1.0, 0, 0.4, -4.0,   0, 3.0, -1.0,
    -2.2, 0.5, 1.0, 0, -2.0, 0.0,   0, 0.4, -4.0,
    // Body to Tail Right
    2.2, 0.5, 1.0,  0, 3.0, -1.0,   0, 0.4, -4.0,
    2.2, 0.5, 1.0,  0, 0.4, -4.0,   0, -2.0, 0.0,
    // Tail Fin
    0, 0.4, -4.0,   0, 2.8, -7.5,   0, -2.5, -7.5,
    0, 0.4, -4.0,   0, -2.5, -7.5,  0, 2.8, -7.5,
  ]);
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}
