import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  AmbientLight, BackSide, BufferGeometry, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Quaternion,
  RingGeometry, SphereGeometry, Vector3,
} from 'three';
import {
  createAnimalTopologyWanderPlayback, type AnimalAirFlockMember,
  type AnimalAirFlockPolicyDefinition, type AnimalAquaticHabitatZone,
  type AnimalAquaticSchoolMember, type AnimalAquaticSchoolPolicyDefinition,
  type AnimalGrazingPatch, type AnimalLandHerdMember,
  type AnimalLandHerdPolicyDefinition, type AnimalRoostSite,
  type AnimalTopologyWandererDefinition, type AnimalVector3,
  type AnimalWaterVolume, type AnimalWorldSurface,
  stepAnimalAirFlock, stepAnimalAquaticSchool, stepAnimalLandHerd,
} from 'triangular-engine/animals';
import { adaptTerrainScatterForAnimals, TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import { TerrainWaterAnimalVolume } from 'triangular-engine/animals/water';
import {
  ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain,
  type ITerrainField, type ITerrainFieldSample, type TerrainVector3,
} from 'triangular-engine/terrain';
import { CylinderWaterDomain, PlaneWaterDomain, SphereWaterDomain, type WaterSurface } from 'triangular-engine/water';
import { generateTerrainScatterInstances, type ITerrainScatterInstance } from 'triangular-engine/scatter';
import { buildFloraMesh, FLORA_OAK_ARCHETYPE, FLORA_OAK_COLORS, generateFloraSkeleton } from 'triangular-engine/procedural';

type Shape = 'plane' | 'sphere' | 'cylinder';
type WorldSize = 'small' | 'medium' | 'large' | 'huge';
const WORLD_SIZES: readonly WorldSize[] = ['small', 'medium', 'large', 'huge'];
const SIZE_FACTOR: Record<WorldSize, number> = { small: 1, medium: 2.2, large: 5.0, huge: 16.0 };
const WATER_SURFACE_OFFSET_M = 0;

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

interface View {
  readonly shape: Shape;
  readonly size: WorldSize;
  readonly label: string;
  readonly root: Group;
  readonly surface: AnimalWorldSurface;
  readonly water: AnimalWaterVolume;
  readonly herdGroups: readonly HerdSimGroup[];
  readonly birdGroups: readonly BirdSimGroup[];
  readonly fishGroups: readonly FishSimGroup[];
  readonly instancedTrees: InstancedMesh | null;
  readonly instancedHerds: InstancedMesh;
  readonly instancedBirds: InstancedMesh;
  readonly instancedFish: InstancedMesh;
  readonly debugMeadowGroup: Group;
  readonly debugRoostGroup: Group;
  readonly debugWaterGroup: Group;
  readonly debugWaypointGroup: Group;
}

@Component({
  selector: 'app-animals-terrain-world-lab-page',
  imports: [EngineModule, DecimalPipe, NgFor, NgIf],
  templateUrl: './animals-terrain-world-lab-page.component.html',
  styleUrl: './animals-terrain-world-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AnimalsTerrainWorldLabPageComponent {
  readonly universalTime = signal(0);
  readonly timeScale = signal(1);
  readonly paused = signal(false);
  readonly selectedShape = signal<Shape>('plane');
  readonly worldSize = signal<WorldSize>('small');
  readonly status = signal<Record<Shape, string>>({ plane: 'ready', sphere: 'ready', cylinder: 'ready' });
  readonly speedOptions = [-10, -5, -1, 0, 1, 5, 10] as const;

  // Debug overlay controls
  readonly showDebug = signal(false);
  readonly hideTrees = signal(false);
  readonly showMeadowPatches = signal(true);
  readonly showRoostSockets = signal(true);
  readonly showWaterClearance = signal(true);
  readonly showWaypoints = signal(true);

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  // Stylized procedural animal geometries
  private readonly animalGeometry = new SphereGeometry(0.32, 12, 8);
  private readonly animalMaterial = new MeshStandardMaterial({ color: '#b87333', roughness: 0.65 });

  private readonly birdGeometry = createBirdGeometry();
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#f7ecd0', roughness: 0.45, side: DoubleSide });

  private readonly fishGeometry = createFishGeometry();
  private readonly fishMaterial = new MeshStandardMaterial({ color: '#e67e22', roughness: 0.35, side: DoubleSide });

  private readonly treeGeometry: BufferGeometry;
  private readonly treeMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });
  private readonly waterMaterial = new MeshStandardMaterial({
    color: '#1a82ad',
    transparent: true,
    opacity: 0.65,
    roughness: 0.1,
    side: DoubleSide,
    depthWrite: false,
  });

  private readonly views: readonly View[];
  private readonly ambientLight: AmbientLight;
  private readonly sunLight: DirectionalLight;

  // Shared reusable matrix helper for zero allocations in hot loop
  private readonly tempMatrix = new Matrix4();
  private readonly zeroMatrix = new Matrix4().makeScale(0, 0, 0);

  constructor() {
    // Generate Master Archetype Tree Geometry with Wind-Weighted Vertex Colors
    const skeleton = generateFloraSkeleton(FLORA_OAK_ARCHETYPE, 777);
    const { geometry } = buildFloraMesh(skeleton, FLORA_OAK_ARCHETYPE);
    colorizeTree(geometry);
    this.treeGeometry = geometry;

    // Atmospheric sky & illumination
    this.engine.scene.background = new Color('#a6d4eb');
    this.ambientLight = new AmbientLight('#ffffff', 0.85);
    this.sunLight = new DirectionalLight('#fff8e7', 1.25);
    this.sunLight.position.set(25, 45, 20);
    this.engine.scene.add(this.ambientLight, this.sunLight);

    const shapes: readonly Shape[] = ['plane', 'sphere', 'cylinder'];
    this.views = WORLD_SIZES.flatMap(size => shapes.map(shape => this.makeSizedView(shape, size)));
    for (const view of this.views) this.engine.scene.add(view.root);
    this.updateViewPresentation();
    this.resetGroupPositions(0);
    this.stepSimulation(0, 0.05);

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

    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      this.ambientLight.removeFromParent();
      this.sunLight.removeFromParent();
      for (const view of this.views) {
        view.root.traverse(object => {
          if (object instanceof Mesh
            && object.geometry !== this.animalGeometry
            && object.geometry !== this.birdGeometry
            && object.geometry !== this.fishGeometry
            && object.geometry !== this.treeGeometry) {
            object.geometry.dispose();
          }
        });
        view.root.removeFromParent();
      }
      this.animalGeometry.dispose();
      this.animalMaterial.dispose();
      this.birdGeometry.dispose();
      this.birdMaterial.dispose();
      this.fishGeometry.dispose();
      this.fishMaterial.dispose();
      this.treeGeometry.dispose();
      this.treeMaterial.dispose();
      this.waterMaterial.dispose();
    });
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

  setShape(shape: Shape): void {
    this.selectedShape.set(shape);
    this.updateViewPresentation();
  }

  setWorldSize(size: WorldSize): void {
    this.worldSize.set(size);
    this.updateViewPresentation();
  }

  togglePause(): void {
    this.paused.update(value => !value);
  }

  toggleDebug(): void {
    this.showDebug.update(v => !v);
    this.updateViewPresentation();
  }

  toggleHideTrees(): void {
    this.hideTrees.update(v => !v);
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

  private updateViewPresentation(): void {
    const selected = this.selectedShape();
    const size = this.worldSize();
    const isDebug = this.showDebug();
    const hideTreeFoliage = isDebug && this.hideTrees();

    for (const view of this.views) {
      const active = view.shape === selected && view.size === size;
      view.root.visible = active;
      if (active) {
        if (view.instancedTrees) {
          view.instancedTrees.visible = !hideTreeFoliage;
        }
        view.debugMeadowGroup.visible = isDebug && this.showMeadowPatches();
        view.debugRoostGroup.visible = isDebug && this.showRoostSockets();
        view.debugWaterGroup.visible = isDebug && this.showWaterClearance();
        view.debugWaypointGroup.visible = isDebug && this.showWaypoints();
      }
    }
  }

  private makeSizedView(shape: Shape, size: WorldSize): View {
    const factor = SIZE_FACTOR[size];
    const field = new WorldTerrainElevationField(shape, factor);
    if (shape === 'plane') {
      return this.makeView(
        shape, size, `${size} infinite plane`,
        field,
        new PlaneTerrainDomain(24 * factor),
        [0, 0, 0],
      );
    }
    if (shape === 'sphere') {
      return this.makeView(
        shape, size, `${size} planet sphere`,
        field,
        new SphereTerrainDomain(9 * factor),
        [0, 0, 0],
      );
    }
    return this.makeView(
      shape, size, `${size} inside cylinder`,
      field,
      new CylinderTerrainDomain({ radiusM: 9 * factor, lengthM: 20 * factor }),
      [0, 0, 0],
    );
  }

  private makeView(
    shape: Shape,
    size: WorldSize,
    label: string,
    field: ITerrainField,
    domain: PlaneTerrainDomain | SphereTerrainDomain | CylinderTerrainDomain,
    offset: readonly [number, number, number],
  ): View {
    const surface = new TerrainAnimalWorldSurface(field, domain, { maxWalkableSlope01: 0.75 });
    const factor = SIZE_FACTOR[size];
    const water = this.makeWaterVolume(shape, factor, surface);

    const root = new Group();
    root.position.set(...offset);
    root.add(this.makeTerrainMesh(shape, factor, field));
    root.add(this.makeWaterMesh(shape, factor));

    // Debug Groups
    const debugMeadowGroup = new Group();
    const debugRoostGroup = new Group();
    const debugWaterGroup = new Group();
    const debugWaypointGroup = new Group();
    root.add(debugMeadowGroup, debugRoostGroup, debugWaterGroup, debugWaypointGroup);

    // =========================================================================
    // UNIFIED BIOME CLASSIFIER: Clean Separation of Water vs Land Biomes
    // =========================================================================
    const sampleCount = size === 'small' ? 96 : size === 'medium' ? 220 : size === 'large' ? 440 : 950;
    const candidatePositions = this.generateUniformGlobalSamples(shape, factor, sampleCount);

    const landBiomePositions: AnimalVector3[] = [];
    const waterBiomePositions: AnimalVector3[] = [];

    for (const pos of candidatePositions) {
      const surfSample = surface.sample(pos);
      if (surfSample.elevationM < -0.65) {
        waterBiomePositions.push(surfSample.position);
      } else if (surfSample.walkable && surfSample.elevationM > 0.55) {
        landBiomePositions.push(surfSample.position);
      }
    }

    if (landBiomePositions.length < 4) {
      const fallbackHome = surface.sample(shape === 'sphere' ? { x: 9 * factor, y: 0, z: 0 } : { x: -4 * factor, y: 0, z: -4 * factor });
      landBiomePositions.push(fallbackHome.position);
    }
    if (waterBiomePositions.length < 2) {
      const fallbackWater = shape === 'plane'
        ? { x: 4.5 * factor, y: 0, z: 4.5 * factor }
        : shape === 'sphere'
          ? { x: -9 * factor, y: 0, z: 0 }
          : { x: 0, y: 9 * factor, z: 0 };
      waterBiomePositions.push(fallbackWater);
    }

    // 1. Grazing Meadows (Open Grassy Clearings on Dry Land)
    const targetMeadowCount = size === 'small' ? 4 : size === 'medium' ? 8 : size === 'large' ? 16 : 36;
    const meadowPositions = filterWithMinDistance(landBiomePositions, 3.5 * Math.min(1.5, factor), targetMeadowCount);
    const grazingPatches: AnimalGrazingPatch[] = meadowPositions.map((pos, index) => {
      const frame = surface.sample(pos);
      return {
        id: `${shape}-${size}-meadow-${index}`,
        position: frame.position,
        radiusM: 2.5 + (index % 2) * 0.5,
        capacity: 10,
        suitability01: 0.9,
      };
    });

    // Build Debug Meadow Rings
    for (const patch of grazingPatches) {
      const frame = surface.sample(patch.position);
      const ring = new Mesh(
        new RingGeometry(patch.radiusM - 0.1, patch.radiusM, 28),
        new MeshBasicMaterial({ color: '#70e000', side: DoubleSide, transparent: true, opacity: 0.7 }),
      );
      ring.position.set(frame.position.x, frame.position.y, frame.position.z);
      ring.quaternion.copy(new Quaternion().setFromUnitVectors(
        new Vector3(0, 0, 1),
        new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z),
      ));
      ring.position.add(new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).multiplyScalar(0.04));
      debugMeadowGroup.add(ring);
    }

    // 2. Tree Groves (Generated as ITerrainScatterInstance and batched into 1 InstancedMesh)
    const targetTreeCount = size === 'small' ? 6 : size === 'medium' ? 14 : size === 'large' ? 28 : 72;
    const treeSeedPositions = filterWithMinDistance(landBiomePositions.slice(2), 4.0 * Math.min(1.5, factor), targetTreeCount);

    const treeInstances: ITerrainScatterInstance[] = treeSeedPositions.map((pos, index) => {
      const frame = surface.sample(pos);
      return {
        instanceId: `tree-${index}` as any,
        worldPositionM: [frame.position.x, frame.position.y, frame.position.z],
        normal: [frame.normal.x, frame.normal.y, frame.normal.z],
        surfaceUp: [frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z],
        rotationSeed01: ((index * 23) % 100) / 100,
        scaleSeed01: 0.4 + (index % 3) * 0.08,
        embedSeed01: 0,
      };
    });

    const adaptedTrees = adaptTerrainScatterForAnimals({
      habitatVersion: `${shape}-${size}-trees`,
      sources: [{
        speciesId: 'tree',
        instances: treeInstances,
        habitatKind: 'grove',
        activities: ['feed', 'rest'],
        obstacleRadiusM: 0.7,
        blocksLand: true,
        roostCapacity: 3,
      }],
    });

    let instancedTrees: InstancedMesh | null = null;
    if (adaptedTrees.obstacles.length > 0) {
      instancedTrees = new InstancedMesh(this.treeGeometry, this.treeMaterial, adaptedTrees.obstacles.length);
      const treeMat = new Matrix4();
      const treeQuat = new Quaternion();
      const treeScale = new Vector3(0.42, 0.42, 0.42);

      adaptedTrees.obstacles.forEach((obstacle, index) => {
        treeQuat.setFromUnitVectors(
          new Vector3(0, 1, 0),
          new Vector3(obstacle.surfaceUp.x, obstacle.surfaceUp.y, obstacle.surfaceUp.z),
        );
        treeMat.compose(
          new Vector3(obstacle.position.x, obstacle.position.y, obstacle.position.z),
          treeQuat,
          treeScale,
        );
        instancedTrees!.setMatrixAt(index, treeMat);
      });

      instancedTrees.instanceMatrix.needsUpdate = true;
      instancedTrees.computeBoundingSphere();
      root.add(instancedTrees);
    }

    // 3. Tree Canopy Roost Sites (Elevated 2.6m into tree branches)
    const birdRoostSites: AnimalRoostSite[] = adaptedTrees.obstacles.map((obs, index) => {
      const perchPos = add(obs.position, scale(obs.surfaceUp, 2.6));

      const socketSphere = new Mesh(
        new SphereGeometry(0.18, 10, 8),
        new MeshStandardMaterial({ color: '#ffbe0b', roughness: 0.3, emissive: '#d48b00', emissiveIntensity: 0.5 }),
      );
      socketSphere.position.set(perchPos.x, perchPos.y, perchPos.z);
      debugRoostGroup.add(socketSphere);

      const lineGeom = new BufferGeometry().setFromPoints([
        new Vector3(obs.position.x, obs.position.y, obs.position.z),
        new Vector3(perchPos.x, perchPos.y, perchPos.z),
      ]);
      const line = new LineSegments(lineGeom, new LineBasicMaterial({ color: '#ffbe0b', transparent: true, opacity: 0.6 }));
      debugRoostGroup.add(line);

      return {
        id: `canopy-roost-${index}`,
        position: perchPos,
        capacity: 3,
      };
    });

    // 4. Underwater Feeding Reefs (Shoreline shallows + Deep water column)
    const targetReefCount = size === 'small' ? 4 : size === 'medium' ? 8 : size === 'large' ? 14 : 32;
    const reefPositions = filterWithMinDistance(waterBiomePositions, 2.6 * Math.min(1.4, factor), targetReefCount);
    const fishZones: AnimalAquaticHabitatZone[] = reefPositions.map((pos, index) => {
      const frame = surface.sample(pos);
      const waterDepth = Math.max(0.65, -frame.elevationM);
      const reefPos = this.projectUnderwater(shape, factor, pos, surface);
      const zoneRadius = Math.min(1.8, Math.max(0.8, (waterDepth - 0.25) * 1.3));

      const volumeCylinder = new Mesh(
        new CylinderGeometry(zoneRadius, zoneRadius, Math.max(0.3, waterDepth * 0.6), 20, 1, true),
        new MeshBasicMaterial({ color: '#00f5d4', side: DoubleSide, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      volumeCylinder.position.set(reefPos.x, reefPos.y, reefPos.z);
      volumeCylinder.quaternion.copy(new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z),
      ));
      debugWaterGroup.add(volumeCylinder);

      return {
        id: `${shape}-${size}-reef-${index}`,
        position: reefPos,
        radiusM: zoneRadius,
        capacity: 10,
        suitability01: 0.95,
      };
    });

    // 5. Land Herd Simulation Groups (Batched into 1 InstancedMesh)
    const herdGroupCount = size === 'small' ? 1 : size === 'medium' ? 2 : size === 'large' ? 4 : 10;
    const membersPerHerd = 5;
    const totalHerdMembers = herdGroupCount * membersPerHerd;
    const instancedHerds = new InstancedMesh(this.animalGeometry, this.animalMaterial, Math.max(1, totalHerdMembers));
    instancedHerds.count = totalHerdMembers;
    instancedHerds.frustumCulled = true;
    root.add(instancedHerds);

    const herdGroups: HerdSimGroup[] = Array.from({ length: herdGroupCount }, (_, groupIdx) => {
      const memberCount = membersPerHerd;
      const count = Math.min(4, Math.max(1, grazingPatches.length));
      const startIdx = (groupIdx * 2) % grazingPatches.length;
      const sectorPatches = deduplicateById(
        Array.from({ length: count }, (__, i) => grazingPatches[(startIdx + i) % grazingPatches.length]),
      );

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-${size}-herd-${groupIdx}`,
        groupSeed: 0x7101 + groupIdx * 41 + shape.length,
        habitats: sectorPatches.map(p => ({ id: p.id, position: p.position, radiusM: p.radiusM })),
        surface,
        travelSpeedMps: 1.8,
        minDwellDurationS: 8,
        maxDwellDurationS: 16,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalLandHerdPolicyDefinition = {
        surface,
        maximumMembers: 32,
        maximumPatches: Math.max(64, sectorPatches.length + 10),
        maximumSpeedMps: 2.2,
        maximumAccelerationMps2: 2.0,
        maximumSubstepDistanceM: 0.5,
        maximumSubsteps: 8,
        maximumSlope01: 0.75,
        maximumPatchDistanceM: 50 * factor,
        minimumPatchSuitability01: 0.5,
        separationRadiusM: 1.6,
        separationWeight: 1.5,
        cohesionWeight: 0.6,
        alignmentWeight: 0.5,
        targetWeight: 1.0,
        arrivalRadiusM: 1.4,
        slotSpacingM: 1.2,
        maximumAvoidanceAttempts: 4,
      };

      const homePos = sectorPatches[0].position;
      const members: AnimalLandHerdMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        const offset = surface.moveAlongSurface(homePos, { x: (memIdx - 2) * 1.0, y: 0, z: (memIdx % 2) * 0.8 }, 1);
        return {
          id: `herd-${groupIdx}-mem-${memIdx}`,
          position: offset,
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'graze' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(0.35),
        new MeshBasicMaterial({ color: '#ff5400', wireframe: true }),
      );
      debugWaypointGroup.add(waypointMesh);

      return {
        wanderer, policy, patches: sectorPatches,
        memberStartIndex: groupIdx * membersPerHerd,
        members, waypointMesh,
      };
    });

    // 6. Bird Flock Simulation Groups (Batched into 1 InstancedMesh)
    const birdGroupCount = size === 'small' ? 1 : size === 'medium' ? 2 : size === 'large' ? 4 : 10;
    const membersPerBirdFlock = 5;
    const totalBirdMembers = birdGroupCount * membersPerBirdFlock;
    const instancedBirds = new InstancedMesh(this.birdGeometry, this.birdMaterial, Math.max(1, totalBirdMembers));
    instancedBirds.count = totalBirdMembers;
    instancedBirds.frustumCulled = true;
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
        ? sectorRoosts.map(r => ({ id: r.id, position: r.position, radiusM: 3.5 }))
        : [{ id: 'sky-base', position: add(landBiomePositions[0], { x: 0, y: 5.0, z: 0 }), radiusM: 4.5 }];

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-${size}-birds-${groupIdx}`,
        groupSeed: 0x3344 + groupIdx * 29 + shape.length,
        habitats: wanderHabitats,
        surface,
        travelSpeedMps: 4.8,
        minDwellDurationS: 6,
        maxDwellDurationS: 12,
        travelArcHeightM: 3.0,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalAirFlockPolicyDefinition = {
        surface,
        maximumMembers: 32,
        maximumRoostSites: Math.max(64, sectorRoosts.length + 10),
        maximumSpeedMps: 5.5,
        maximumAccelerationMps2: 4.0,
        maximumSubstepDistanceM: 0.8,
        maximumSubsteps: 8,
        minimumAltitudeM: 1.8,
        maximumAltitudeM: 14.0,
        preferredAltitudeM: 4.8,
        flightBehavior: 'boid3d',
        flightAltitudeSpreadM: 1.2,
        separationRadiusM: 1.8,
        separationWeight: 1.5,
        cohesionWeight: 0.8,
        alignmentWeight: 1.0,
        targetWeight: 1.2,
        arrivalRadiusM: 1.5,
        holdingRadiusM: 3.5,
        holdingSpeedMps: 2.6,
        roostSlotSpacingM: 1.3,
      };

      const homePos = wanderHabitats[0].position;
      const members: AnimalAirFlockMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        const frame = surface.sample(homePos);
        const altPos = add(homePos, scale(frame.surfaceUp, 2.5));
        return {
          id: `bird-${groupIdx}-mem-${memIdx}`,
          position: add(altPos, { x: (memIdx - 2) * 0.8, y: 0, z: (memIdx % 2) * 0.8 }),
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'holding' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(0.35),
        new MeshBasicMaterial({ color: '#f72585', wireframe: true }),
      );
      debugWaypointGroup.add(waypointMesh);

      return {
        wanderer, policy, roostSites: sectorRoosts,
        memberStartIndex: groupIdx * membersPerBirdFlock,
        members, waypointMesh,
      };
    });

    // 7. Fish School Simulation Groups (Batched into 1 InstancedMesh)
    const fishGroupCount = size === 'small' ? 1 : size === 'medium' ? 2 : size === 'large' ? 3 : 8;
    const membersPerFishSchool = 5;
    const totalFishMembers = fishGroupCount * membersPerFishSchool;
    const instancedFish = new InstancedMesh(this.fishGeometry, this.fishMaterial, Math.max(1, totalFishMembers));
    instancedFish.count = totalFishMembers;
    instancedFish.frustumCulled = true;
    root.add(instancedFish);

    const fishGroups: FishSimGroup[] = Array.from({ length: fishGroupCount }, (_, groupIdx) => {
      const memberCount = membersPerFishSchool;
      const zoneCount = Math.min(3, Math.max(1, fishZones.length));
      const startIdx = (groupIdx * 2) % Math.max(1, fishZones.length);
      const sectorZones = deduplicateById(
        Array.from({ length: zoneCount }, (__, i) => fishZones[(startIdx + i) % fishZones.length]),
      );

      const wanderDef: AnimalTopologyWandererDefinition = {
        groupId: `${shape}-${size}-fish-${groupIdx}`,
        groupSeed: 0x9922 + groupIdx * 17 + shape.length,
        habitats: sectorZones.map(p => ({ id: p.id, position: p.position, radiusM: p.radiusM })),
        surface,
        travelSpeedMps: 2.2,
        minDwellDurationS: 7,
        maxDwellDurationS: 14,
      };

      const wanderer = createAnimalTopologyWanderPlayback(wanderDef);
      const policy: AnimalAquaticSchoolPolicyDefinition = {
        water,
        maximumMembers: 32,
        maximumZones: Math.max(32, sectorZones.length + 10),
        maximumZoneDistanceM: 50 * factor,
        minimumZoneSuitability01: 0.5,
        maximumSpeedMps: 2.6,
        maximumAccelerationMps2: 2.8,
        maximumSubstepDistanceM: 0.6,
        maximumSubsteps: 8,
        minimumSurfaceClearanceM: 0.08,
        minimumBottomClearanceM: 0.08,
        preferredSurfaceClearanceM: 0.22,
        maximumSurfaceClearanceM: 3.5,
        segmentSampleSpacingM: 0.4,
        separationRadiusM: 0.9,
        separationWeight: 1.4,
        cohesionWeight: 0.8,
        alignmentWeight: 0.9,
        targetWeight: 1.1,
        flowWeight: 0.2,
        depthWeight: 0.7,
        arrivalRadiusM: 1.1,
        slotSpacingM: 0.6,
        loiterRadiusM: 0.9,
        loiterAngularSpeedRadPerSecond: 0.9,
        maximumAvoidanceAttempts: 4,
      };

      const homePos = sectorZones[0].position;
      const members: AnimalAquaticSchoolMember[] = Array.from({ length: memberCount }, (__, memIdx) => {
        return {
          id: `fish-${groupIdx}-mem-${memIdx}`,
          position: add(homePos, { x: (memIdx - 2) * 0.25, y: 0, z: (memIdx % 2) * 0.25 }),
          velocity: { x: 0, y: 0, z: 0 },
          mode: 'forage' as const,
        };
      });

      const waypointMesh = new Mesh(
        new OctahedronGeometry(0.35),
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
      shape, size, label, root, surface, water,
      herdGroups, birdGroups, fishGroups,
      instancedTrees, instancedHerds, instancedBirds, instancedFish,
      debugMeadowGroup, debugRoostGroup, debugWaterGroup, debugWaypointGroup,
    };
  }

  private generateUniformGlobalSamples(shape: Shape, factor: number, count: number): AnimalVector3[] {
    const samples: AnimalVector3[] = [];
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle

    if (shape === 'sphere') {
      const radius = 9 * factor;
      for (let i = 0; i < count; i++) {
        const y = 1 - (i / Math.max(1, count - 1)) * 2;
        const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = phi * i;
        const x = Math.cos(theta) * rAtY;
        const z = Math.sin(theta) * rAtY;
        samples.push({ x: x * radius, y: y * radius, z: z * radius });
      }
      return samples;
    }

    if (shape === 'cylinder') {
      const radius = 9 * factor;
      const length = 20 * factor;
      for (let i = 0; i < count; i++) {
        const x = ((i / Math.max(1, count - 1)) - 0.5) * (0.85 * length);
        const theta = (phi * i) % (Math.PI * 2);
        samples.push({ x, y: radius * Math.cos(theta), z: radius * Math.sin(theta) });
      }
      return samples;
    }

    // Plane: comprehensive uniform 2D grid covering entire map and full lake perimeter
    const halfWidth = 10.5 * factor;
    const gridDim = Math.ceil(Math.sqrt(count));
    const step = (halfWidth * 2) / gridDim;
    for (let ix = 0; ix < gridDim; ix++) {
      for (let iz = 0; iz < gridDim; iz++) {
        if (samples.length >= count) break;
        const jitterX = Math.sin(ix * 13.7 + iz * 9.3) * 0.3 * step;
        const jitterZ = Math.cos(ix * 7.1 + iz * 17.3) * 0.3 * step;
        const x = -halfWidth + (ix + 0.5) * step + jitterX;
        const z = -halfWidth + (iz + 0.5) * step + jitterZ;
        samples.push({ x, y: 0, z });
      }
    }
    return samples;
  }

  private projectUnderwater(shape: Shape, factor: number, position: AnimalVector3, surface: AnimalWorldSurface): AnimalVector3 {
    const frame = surface.sample(position);

    if (shape === 'sphere') {
      const len = Math.hypot(position.x, position.y, position.z) || 1;
      const baseRadius = 9 * factor;
      const waterDepth = Math.max(0.45, -frame.elevationM);
      const cruiseOffset = frame.elevationM + waterDepth * 0.5;
      const cruiseRadius = baseRadius + cruiseOffset;
      return {
        x: (position.x / len) * cruiseRadius,
        y: (position.y / len) * cruiseRadius,
        z: (position.z / len) * cruiseRadius,
      };
    }

    if (shape === 'cylinder') {
      const radial = Math.hypot(position.y, position.z) || 1;
      const baseRadius = 9 * factor;
      const waterDepth = Math.max(0.45, -frame.elevationM);
      const cruiseOffset = frame.elevationM + waterDepth * 0.5;
      const cruiseRadius = baseRadius - cruiseOffset;
      return {
        x: position.x,
        y: (position.y / radial) * cruiseRadius,
        z: (position.z / radial) * cruiseRadius,
      };
    }

    // Plane: water surface is y = 0, seabed is frame.elevationM (< 0)
    const waterDepth = Math.max(0.45, -frame.elevationM);
    const cruiseY = frame.elevationM + waterDepth * 0.5;
    return { x: frame.position.x, y: cruiseY, z: frame.position.z };
  }

  private makeWaterVolume(shape: Shape, factor: number, terrainSurface: AnimalWorldSurface): AnimalWaterVolume {
    const surface: WaterSurface = {
      getHeight: () => WATER_SURFACE_OFFSET_M,
      getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
      getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.15, 0, 0.05),
    };
    const domain = shape === 'plane'
      ? new PlaneWaterDomain()
      : shape === 'sphere'
        ? new SphereWaterDomain(9 * factor)
        : new CylinderWaterDomain(9 * factor, { axis: new Vector3(1, 0, 0), lengthM: 20 * factor });

    return new TerrainWaterAnimalVolume({
      terrain: terrainSurface,
      bodies: [{ body: { id: `${shape}-water`, domain, surface } }],
    });
  }

  private makeTerrainMesh(shape: Shape, factor = 1, field: ITerrainField): Mesh {
    const segs = factor > 6 ? 120 : 72;

    if (shape === 'sphere') {
      const baseRadius = 9 * factor;
      const geometry = new SphereGeometry(baseRadius, segs, Math.round(segs * 0.75));
      const positions = geometry.getAttribute('position');
      const colors = new Float32Array(positions.count * 3);
      const lushGreen = new Color('#528f3c');
      const warmGrass = new Color('#6ba347');
      const sandyBeach = new Color('#d4c088');
      const oceanSeabed = new Color('#1c3f56');

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const len = Math.hypot(x, y, z) || 1;
        const relief = field.sample([x, y, z]).elevationM;
        const newRadius = baseRadius + relief;
        positions.setXYZ(i, (x / len) * newRadius, (y / len) * newRadius, (z / len) * newRadius);

        let color = lushGreen;
        if (relief < -0.4) {
          color = oceanSeabed;
        } else if (relief < 0.25) {
          color = sandyBeach;
        } else if (relief < 0.8) {
          color = warmGrass;
        }
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    }

    if (shape === 'cylinder') {
      const baseRadius = 9 * factor;
      const length = 20 * factor;
      const geometry = new CylinderGeometry(baseRadius, baseRadius, length, segs, Math.round(segs * 0.75), true);
      geometry.rotateZ(Math.PI / 2);

      const positions = geometry.getAttribute('position');
      const colors = new Float32Array(positions.count * 3);
      const lushGreen = new Color('#528f3c');
      const warmGrass = new Color('#6ba347');
      const sandyBeach = new Color('#d4c088');
      const canalSeabed = new Color('#1c3f56');

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const radial = Math.hypot(y, z) || 1;
        const relief = field.sample([x, y, z]).elevationM;
        const newRadius = baseRadius - relief;
        positions.setXYZ(i, x, (y / radial) * newRadius, (z / radial) * newRadius);

        let color = lushGreen;
        if (relief < -0.4) {
          color = canalSeabed;
        } else if (relief < 0.25) {
          color = sandyBeach;
        } else if (relief < 0.8) {
          color = warmGrass;
        }
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: BackSide }));
    }

    // Plane
    const size = 24 * factor;
    const geometry = new PlaneGeometry(size, size, segs, segs);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const lushGreen = new Color('#528f3c');
    const warmGrass = new Color('#6ba347');
    const sandyBeach = new Color('#d4c088');
    const lakeSeabed = new Color('#1c3f56');

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const relief = field.sample([x, 0, z]).elevationM;
      positions.setY(i, relief);

      let color = lushGreen;
      if (relief < -0.4) {
        color = lakeSeabed;
      } else if (relief < 0.25) {
        color = sandyBeach;
      } else if (relief < 0.8) {
        color = warmGrass;
      }
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  }

  private makeWaterMesh(shape: Shape, factor = 1): Mesh {
    const segs = factor > 6 ? 96 : 54;
    if (shape === 'sphere') {
      return new Mesh(new SphereGeometry(9 * factor, segs, Math.round(segs * 0.75)), this.waterMaterial);
    }
    if (shape === 'cylinder') {
      const geometry = new CylinderGeometry(9 * factor, 9 * factor, 20 * factor, segs, 1, true);
      geometry.rotateZ(Math.PI / 2);
      return new Mesh(geometry, this.waterMaterial);
    }
    const mesh = new Mesh(new PlaneGeometry(24 * factor, 24 * factor), this.waterMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = WATER_SURFACE_OFFSET_M;
    return mesh;
  }

  private resetGroupPositions(universalTime: number): void {
    for (const view of this.views) {
      for (const herd of view.herdGroups) {
        const snap = herd.wanderer.sample(universalTime);
        const center = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
        herd.members = herd.members.map((m, idx) => ({
          ...m,
          position: view.surface.moveAlongSurface(center, { x: (idx - 2) * 0.8, y: 0, z: (idx % 2) * 0.8 }, 1),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
      for (const bird of view.birdGroups) {
        const snap = bird.wanderer.sample(universalTime);
        const frame = view.surface.sample(snap.position);
        const center = add(snap.position, scale(frame.surfaceUp, 3.5));
        bird.members = bird.members.map((m, idx) => ({
          ...m,
          position: add(center, { x: (idx - 2) * 0.7, y: 0, z: (idx % 2) * 0.7 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
      for (const fish of view.fishGroups) {
        const snap = fish.wanderer.sample(universalTime);
        const center = snap.currentHabitat.position;
        fish.members = fish.members.map((m, idx) => ({
          ...m,
          position: add(center, { x: (idx - 2) * 0.25, y: 0, z: (idx % 2) * 0.25 }),
          velocity: { x: 0, y: 0, z: 0 },
        }));
      }
    }
  }

  private stepSimulation(universalTime: number, deltaSeconds: number): void {
    const statuses = { ...this.status() };
    const activeShape = this.selectedShape();
    const activeSize = this.worldSize();

    // Active camera position for planetary-scale observer culling & life materialization
    const camPos = this.engine.camera ? this.engine.camera.position : new Vector3(0, 22, 42);
    const activeObserverRadiusM = activeSize === 'huge' ? 140 : 10000;

    for (const view of this.views) {
      if (view.shape !== activeShape || view.size !== activeSize) continue;

      let herdAct = '';
      let birdAct = '';
      let fishAct = '';

      // 1. Step Land Herds (Instanced Batch + Proximity Culling)
      for (const group of view.herdGroups) {
        const snap = group.wanderer.sample(universalTime);
        herdAct = snap.activity;
        const target = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
        const intent = snap.activity === 'travel' ? 'travel' as const : 'graze' as const;

        group.waypointMesh.position.set(target.x, target.y + 0.5, target.z);

        const distToCamera = Math.hypot(target.x - camPos.x, target.y - camPos.y, target.z - camPos.z);
        if (distToCamera > activeObserverRadiusM) {
          // Beyond observer horizon: Cull instances and skip micro collision substeps
          for (let i = 0; i < group.members.length; i++) {
            view.instancedHerds.setMatrixAt(group.memberStartIndex + i, this.zeroMatrix);
          }
          continue;
        }

        // On-demand materialization: if entering observer bubble after being dormant, align members to current target
        const firstMemDist = Math.hypot(
          group.members[0].position.x - target.x,
          group.members[0].position.y - target.y,
          group.members[0].position.z - target.z,
        );
        if (firstMemDist > 12.0) {
          group.members = group.members.map((m, idx) => ({
            ...m,
            position: view.surface.moveAlongSurface(target, { x: (idx - 2) * 1.0, y: 0, z: (idx % 2) * 0.8 }, 1),
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
        this.writeHerdInstances(view, group);
      }
      view.instancedHerds.instanceMatrix.needsUpdate = true;

      // 2. Step Bird Flocks (Instanced Batch + Proximity Culling)
      for (const group of view.birdGroups) {
        const snap = group.wanderer.sample(universalTime);
        birdAct = snap.activity;
        const target = snap.activity === 'travel' ? snap.position : snap.currentHabitat.position;
        const intent = snap.activity === 'travel' ? 'fly' as const : 'roost' as const;

        group.waypointMesh.position.set(target.x, target.y, target.z);

        const distToCamera = Math.hypot(target.x - camPos.x, target.y - camPos.y, target.z - camPos.z);
        if (distToCamera > activeObserverRadiusM) {
          for (let i = 0; i < group.members.length; i++) {
            view.instancedBirds.setMatrixAt(group.memberStartIndex + i, this.zeroMatrix);
          }
          continue;
        }

        // On-demand materialization: align boid flock to current macro target
        const firstMemDist = Math.hypot(
          group.members[0].position.x - target.x,
          group.members[0].position.y - target.y,
          group.members[0].position.z - target.z,
        );
        if (firstMemDist > 15.0) {
          const frame = view.surface.sample(target);
          const altPos = add(target, scale(frame.surfaceUp, 2.5));
          group.members = group.members.map((m, idx) => ({
            ...m,
            position: add(altPos, { x: (idx - 2) * 0.8, y: 0, z: (idx % 2) * 0.8 }),
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
        this.writeBirdInstances(view, group);
      }
      view.instancedBirds.instanceMatrix.needsUpdate = true;

      // 3. Step Fish Schools (Instanced Batch + Proximity Culling)
      const factor = SIZE_FACTOR[view.size];
      for (const group of view.fishGroups) {
        const snap = group.wanderer.sample(universalTime);
        fishAct = snap.activity;
        const target = snap.activity === 'travel'
          ? this.projectUnderwater(view.shape, factor, snap.position, view.surface)
          : snap.currentHabitat.position;
        const intent = snap.activity === 'travel' ? 'travel' as const : 'forage' as const;

        group.waypointMesh.position.set(target.x, target.y, target.z);

        const distToCamera = Math.hypot(target.x - camPos.x, target.y - camPos.y, target.z - camPos.z);
        if (distToCamera > activeObserverRadiusM) {
          for (let i = 0; i < group.members.length; i++) {
            view.instancedFish.setMatrixAt(group.memberStartIndex + i, this.zeroMatrix);
          }
          continue;
        }

        // On-demand materialization: align fish school to current macro target
        const firstMemDist = Math.hypot(
          group.members[0].position.x - target.x,
          group.members[0].position.y - target.y,
          group.members[0].position.z - target.z,
        );
        if (firstMemDist > 12.0) {
          group.members = group.members.map((m, idx) => ({
            ...m,
            position: add(target, { x: (idx - 2) * 0.25, y: 0, z: (idx % 2) * 0.25 }),
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
        this.writeFishInstances(view, group);
      }
      view.instancedFish.instanceMatrix.needsUpdate = true;

      statuses[view.shape] = `${view.size}: herds [${herdAct}] · birds [${birdAct}] · fish [${fishAct}] · 4 draw calls`;
    }

    this.status.set(statuses);
  }

  private writeHerdInstances(view: View, group: HerdSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const frame = view.surface.sample(member.position);
      const pos = new Vector3(
        frame.position.x + frame.surfaceUp.x * 0.32,
        frame.position.y + frame.surfaceUp.y * 0.32,
        frame.position.z + frame.surfaceUp.z * 0.32,
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
      view.instancedHerds.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }

  private writeBirdInstances(view: View, group: BirdSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
      const frame = view.surface.sample(member.position);
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
      view.instancedBirds.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }

  private writeFishInstances(view: View, group: FishSimGroup): void {
    group.members.forEach((member, index) => {
      const globalIdx = group.memberStartIndex + index;
      const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
      const frame = view.surface.sample(member.position);
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
      view.instancedFish.setMatrixAt(globalIdx, this.tempMatrix);
    });
  }
}

function scale(value: AnimalVector3, factor: number): AnimalVector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function add(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

/**
 * Natural C1-continuous terrain elevation field.
 * Smoothly connects deep water basins through gentle sandy beach ramps to elevated green hills.
 */
class WorldTerrainElevationField extends ConstantTerrainField {
  constructor(private readonly shape: Shape, private readonly scaleFactor = 1) {
    super(0);
  }

  override sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const scale = Math.max(1, this.scaleFactor);

    if (this.shape === 'sphere') {
      const len = Math.hypot(x, y, z) || 1;
      const nx = x / len;
      const ny = y / len;
      const nz = z / len;

      const oceanTransition = smoothstep(-0.4, 0.05, nx);
      const seabedDepthM = -2.0 * Math.min(2.5, scale * 0.6);
      const hillRelief = Math.sin(ny * 3.5) * 0.45 + Math.cos(nz * 3.2) * 0.4;
      const landHeightM = (0.8 + Math.max(0, hillRelief)) * Math.min(2.0, scale * 0.5);

      const elevationM = seabedDepthM * (1 - oceanTransition) + landHeightM * oceanTransition;
      return { elevationM };
    }

    if (this.shape === 'cylinder') {
      const angle = Math.atan2(z, y);
      const distFromCanalCenter = Math.abs(Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI)));

      const canalTransition = smoothstep(0.35, 0.95, distFromCanalCenter);
      const bedDepthM = -2.0 * Math.min(2.5, scale * 0.6);
      const hillRelief = Math.sin(x / (3.5 * scale)) * 0.4 + Math.cos(angle * 2) * 0.35;
      const bankHeightM = (0.8 + Math.max(0, hillRelief)) * Math.min(2.0, scale * 0.5);

      const elevationM = bedDepthM * (1 - canalTransition) + bankHeightM * canalTransition;
      return { elevationM };
    }

    // Plane: smooth natural lake basin centered at (4.5*scale, 4.5*scale)
    const cx = 4.5 * scale;
    const cz = 4.5 * scale;
    const distToLake = Math.hypot(x - cx, z - cz);

    const lakeBedRadius = 2.5 * scale;
    const shorelineRadius = 6.2 * scale;

    const lakeTransition = smoothstep(lakeBedRadius, shorelineRadius, distToLake);
    const lakeBedDepthM = -1.8 * Math.min(2.5, scale * 0.6);
    const rollingHills = Math.sin(x / (4.0 * scale)) * 0.5 + Math.cos(z / (4.5 * scale)) * 0.45;
    const landHeightM = (0.8 + Math.max(0, rollingHills)) * Math.min(2.0, scale * 0.5);

    const elevationM = lakeBedDepthM * (1 - lakeTransition) + landHeightM * lakeTransition;
    return { elevationM };
  }
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
    0, 0.02, 0.42,    0, 0.14, 0.16,   -0.09, 0.04, 0.16,
    0, 0.02, 0.42,    0.09, 0.04, 0.16,  0, 0.14, 0.16,
    // Beak Bottom
    0, 0.02, 0.42,   -0.09, 0.04, 0.16,  0, -0.08, 0.10,
    0, 0.02, 0.42,    0, -0.08, 0.10,    0.09, 0.04, 0.16,
    // Left Wing (Top & Bottom)
    0, 0.14, 0.16,   -0.65, 0.10, -0.06, 0, 0.09, -0.18,
    -0.09, 0.04, 0.16, -0.65, 0.10, -0.06, 0, -0.08, 0.10,
    // Right Wing (Top & Bottom)
    0, 0.14, 0.16,    0, 0.09, -0.18,    0.65, 0.10, -0.06,
    0.09, 0.04, 0.16,  0, -0.08, 0.10,   0.65, 0.10, -0.06,
    // Tail
    0, 0.09, -0.18,  -0.18, 0.08, -0.42, 0.18, 0.08, -0.42,
    0, 0.09, -0.18,   0.18, 0.08, -0.42, 0, -0.08, 0.10,
    0, 0.09, -0.18,   0, -0.08, 0.10,   -0.18, 0.08, -0.42,
  ]);
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}

function createFishGeometry(): BufferGeometry {
  const geom = new BufferGeometry();
  const vertices = new Float32Array([
    // Snout / Head Left
    0, 0.02, 0.35,   -0.14, 0.03, 0.06,  0, 0.18, -0.06,
    0, 0.02, 0.35,    0, -0.12, 0.0,    -0.14, 0.03, 0.06,
    // Snout / Head Right
    0, 0.02, 0.35,    0, 0.18, -0.06,    0.14, 0.03, 0.06,
    0, 0.02, 0.35,    0.14, 0.03, 0.06,  0, -0.12, 0.0,
    // Body to Tail Left
    -0.14, 0.03, 0.06, 0, 0.02, -0.26,  0, 0.18, -0.06,
    -0.14, 0.03, 0.06, 0, -0.12, 0.0,   0, 0.02, -0.26,
    // Body to Tail Right
    0.14, 0.03, 0.06,  0, 0.18, -0.06,  0, 0.02, -0.26,
    0.14, 0.03, 0.06,  0, 0.02, -0.26,  0, -0.12, 0.0,
    // Tail Fin (Double-sided)
    0, 0.02, -0.26,  0, 0.16, -0.45,   0, -0.14, -0.45,
    0, 0.02, -0.26,  0, -0.14, -0.45,  0, 0.16, -0.45,
  ]);
  geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}
