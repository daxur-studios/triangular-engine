import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe, NgFor } from '@angular/common';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  BackSide, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial,
  PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';
import {
  createAnimalLandHerdCyclePlayback, type AnimalLandHerdCycleDefinition, type AnimalLandHerdMember,
  type AnimalGrazingPatch, type AnimalWorldSurface, type AnimalVector3,
  createAnimalAirFlockCyclePlayback, type AnimalAirFlockCycleDefinition, type AnimalAirFlockMember,
  createAnimalAquaticSchoolCyclePlayback, type AnimalAquaticSchoolCycleDefinition, type AnimalAquaticSchoolMember,
  type AnimalWaterVolume, animalUnit,
} from 'triangular-engine/animals';
import { adaptTerrainScatterForAnimals, TerrainAnimalWorldSurface } from 'triangular-engine/animals/terrain';
import { TerrainWaterAnimalVolume } from 'triangular-engine/animals/water';
import {
  ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain,
  type ITerrainField, type ITerrainFieldSample, type TerrainVector3,
} from 'triangular-engine/terrain';
import { CylinderWaterDomain, PlaneWaterDomain, SphereWaterDomain, type WaterSurface } from 'triangular-engine/water';
import { buildFloraMesh, FLORA_OAK_ARCHETYPE, FLORA_OAK_COLORS, generateFloraSkeleton } from 'triangular-engine/procedural';

type Shape = 'plane' | 'sphere' | 'cylinder';
type WorldSize = 'small' | 'medium' | 'large';
const WORLD_SIZES: readonly WorldSize[] = ['small', 'medium', 'large'];
const SIZE_FACTOR: Record<WorldSize, number> = { small: 1, medium: 2.5, large: 6 };
const WATER_DEPTH_M = 3;
const FISH_DEPTH_M = 1.4;

interface View {
  readonly shape: Shape;
  readonly size: WorldSize;
  readonly label: string;
  readonly root: Group;
  readonly surface: AnimalWorldSurface;
  readonly water: AnimalWaterVolume;
  readonly playbacks: readonly ReturnType<typeof createAnimalLandHerdCyclePlayback>[];
  readonly birdPlaybacks: readonly ReturnType<typeof createAnimalAirFlockCyclePlayback>[];
  readonly fishPlaybacks: readonly ReturnType<typeof createAnimalAquaticSchoolCyclePlayback>[];
  readonly animals: readonly Mesh[];
  readonly birds: readonly Mesh[];
  readonly fish: readonly Mesh[];
  readonly trees: readonly Mesh[];
}

@Component({
  selector: 'app-animals-terrain-world-lab-page',
  imports: [EngineModule, DecimalPipe, NgFor],
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

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly animalGeometry = new SphereGeometry(0.32, 12, 8);
  private readonly animalMaterial = new MeshStandardMaterial({ color: '#d39a57', roughness: 0.7 });
  private readonly birdGeometry = new ConeGeometry(0.18, 0.65, 5);
  private readonly birdMaterial = new MeshStandardMaterial({ color: '#f3ecc2', roughness: 0.6 });
  private readonly fishGeometry = new ConeGeometry(0.16, 0.65, 6);
  private readonly fishMaterial = new MeshStandardMaterial({ color: '#f0a84b', roughness: 0.5 });
  private readonly treeMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide });
  private readonly waterMaterial = new MeshStandardMaterial({ color: '#3888b5', transparent: true, opacity: 0.45, roughness: 0.2 });
  private readonly views: readonly View[];

  constructor() {
    const shapes: readonly Shape[] = ['plane', 'sphere', 'cylinder'];
    this.views = WORLD_SIZES.flatMap(size => shapes.map(shape => this.makeSizedView(shape, size)));
    for (const view of this.views) this.engine.scene.add(view.root);
    this.updateViewPresentation();
    this.render(0);

    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!this.paused() && this.timeScale() !== 0) {
        this.universalTime.update(t => t + dt * this.timeScale());
        this.render(this.universalTime());
      }
    }, 50);

    this.destroyRef.onDestroy(() => {
      window.clearInterval(timer);
      for (const view of this.views) {
        view.root.traverse(object => {
          if (object instanceof Mesh
            && object.geometry !== this.animalGeometry
            && object.geometry !== this.birdGeometry
            && object.geometry !== this.fishGeometry) {
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
      this.treeMaterial.dispose();
      this.waterMaterial.dispose();
    });
  }

  setUniversalTime(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.universalTime.set(value);
      this.render(value);
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

  reset(): void {
    this.universalTime.set(0);
    this.timeScale.set(1);
    this.paused.set(false);
    this.render(0);
  }

  private updateViewPresentation(): void {
    const selected = this.selectedShape();
    const size = this.worldSize();
    for (const view of this.views) {
      view.root.visible = view.shape === selected && view.size === size;
    }
  }

  private makeSizedView(shape: Shape, size: WorldSize): View {
    const factor = SIZE_FACTOR[size];
    if (shape === 'plane') {
      return this.makeView(
        shape, size, `${size} infinite plane`,
        new TerrainCheckpointField(factor),
        new PlaneTerrainDomain(20 * factor),
        [0, 0, 0],
        { x: 0, y: 0, z: 0 },
      );
    }
    if (shape === 'sphere') {
      return this.makeView(
        shape, size, `${size} planet sphere`,
        new TerrainCheckpointField(factor),
        new SphereTerrainDomain(8 * factor),
        [0, 0, 0],
        { x: 8 * factor, y: 0, z: 0 },
      );
    }
    return this.makeView(
      shape, size, `${size} inside cylinder`,
      new TerrainCheckpointField(factor),
      new CylinderTerrainDomain({ radiusM: 8 * factor, lengthM: 16 * factor }),
      [0, 0, 0],
      { x: 0, y: 0, z: 0 },
    );
  }

  private makeView(
    shape: Shape,
    size: WorldSize,
    label: string,
    field: ITerrainField,
    domain: PlaneTerrainDomain | SphereTerrainDomain | CylinderTerrainDomain,
    offset: readonly [number, number, number],
    query: AnimalVector3,
  ): View {
    const surface = new TerrainAnimalWorldSurface(field, domain, { maxWalkableSlope01: 0.75 });
    const factor = SIZE_FACTOR[size];
    const root = new Group();
    root.position.set(...offset);
    root.add(this.makeTerrain(shape, factor, field));
    root.add(this.makeWaterMesh(shape, factor));

    const home = surface.sample(query);

    // Procedural distribution of grazing meadows
    const patchCount = size === 'small' ? 5 : size === 'medium' ? 14 : 28;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const grazingPatches: AnimalGrazingPatch[] = Array.from({ length: patchCount }, (_, index) => {
      if (index === 0) {
        return { id: `${shape}-${size}-meadow-0`, position: home.position, radiusM: 2.5, capacity: 12, suitability01: 1 };
      }
      const angle = index * goldenAngle;
      const dist = (Math.sqrt(index) / Math.sqrt(patchCount)) * (8 * factor) + 2;
      const u = Math.cos(angle) * dist;
      const v = Math.sin(angle) * dist;
      const targetPos = surface.moveAlongSurface(home.position, add(scale(home.tangentU, u), scale(home.tangentV, v)), 1);
      const sampled = surface.sample(targetPos);
      return {
        id: `${shape}-${size}-meadow-${index}`,
        position: sampled.position,
        radiusM: 2.2 + (index % 3) * 0.4,
        capacity: 10,
        suitability01: sampled.walkable ? 0.75 + (index % 4) * 0.08 : 0.4,
      };
    });

    for (const p of grazingPatches) root.add(this.patchMesh(p, surface));

    // Procedural distribution of tree scatter instances in groves
    const treeCount = size === 'small' ? 8 : size === 'medium' ? 22 : 44;
    const scatterInstances = Array.from({ length: treeCount }, (_, index) => {
      const angle = index * goldenAngle + 0.8;
      const dist = (Math.sqrt(index + 0.5) / Math.sqrt(treeCount)) * (9 * factor) + 1.5;
      const u = Math.cos(angle) * dist;
      const v = Math.sin(angle) * dist;
      const treePos = surface.moveAlongSurface(home.position, add(scale(home.tangentU, u), scale(home.tangentV, v)), 1);
      const frame = surface.sample(treePos);
      return {
        instanceId: `tree-${index}`,
        worldPositionM: [frame.position.x, frame.position.y, frame.position.z] as [number, number, number],
        normal: [frame.normal.x, frame.normal.y, frame.normal.z] as [number, number, number],
        surfaceUp: [frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z] as [number, number, number],
        rotationSeed01: index / 7,
        scaleSeed01: 0.4 + (index % 5) * 0.1,
        embedSeed01: 0,
      };
    });

    const adapted = adaptTerrainScatterForAnimals({
      habitatVersion: `${shape}-${size}-v1`,
      sources: [{
        speciesId: 'tree',
        instances: scatterInstances,
        habitatKind: 'grove',
        activities: ['feed', 'rest'],
        obstacleRadiusM: 0.6,
        blocksLand: true,
        roostCapacity: 2,
      }],
    });

    const trees = adapted.obstacles.map((obstacle, index) => {
      const seed = 420 + index;
      const skeleton = generateFloraSkeleton(FLORA_OAK_ARCHETYPE, seed);
      const { geometry } = buildFloraMesh(skeleton, FLORA_OAK_ARCHETYPE);
      colorizeTree(geometry);
      const tree = new Mesh(geometry, this.treeMaterial);
      tree.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
      tree.quaternion.copy(new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(obstacle.surfaceUp.x, obstacle.surfaceUp.y, obstacle.surfaceUp.z),
      ));
      tree.scale.setScalar(0.55);
      root.add(tree);
      return tree;
    });

    // Herds configuration
    const groupCount = size === 'small' ? 2 : size === 'medium' ? 5 : 10;
    const herdPolicy = {
      surface,
      maximumMembers: 16,
      maximumPatches: Math.max(64, patchCount + 10),
      maximumSpeedMps: 2.2,
      maximumAccelerationMps2: 3.5,
      maximumSubstepDistanceM: 0.25,
      maximumSubsteps: 8,
      maximumSlope01: 0.75,
      maximumPatchDistanceM: Math.max(30, 15 * factor),
      minimumPatchSuitability01: 0.4,
      separationRadiusM: 1.4,
      separationWeight: 2.8,
      cohesionWeight: 0.2,
      alignmentWeight: 0.25,
      targetWeight: 0.6,
      arrivalRadiusM: 0.35,
      slotSpacingM: 0.75,
      travelLineSpacingM: 1.2,
      leaderFollowDelaySeconds: 0.8,
      maximumAvoidanceAttempts: 4,
      obstacles: adapted.obstacles,
    };

    const herdDefinitions: AnimalLandHerdCycleDefinition[] = Array.from({ length: groupCount }, (_, index) => {
      const homePatchIndex = (index * 3) % grazingPatches.length;
      const groupHome = grazingPatches[homePatchIndex];
      return {
        groupId: `${shape}-${size}-herd-${index}`,
        groupSeed: 0x7a11 + index * 31 + shape.length,
        memberCount: 6,
        homePatch: groupHome,
        grazingPatches,
        restDurationS: 6,
        outboundTravelDurationS: 10,
        grazeDurationS: 10,
        returnTravelDurationS: 12,
        fixedStepSeconds: 0.1,
        maximumReplaySteps: 400,
        policy: herdPolicy,
      };
    });

    // Birds configuration
    const birdRoostSites = adapted.roostSites.map(site => {
      const frame = surface.sample(site.position);
      return { ...site, capacity: 2, position: add(site.position, scale(frame.surfaceUp, 3.2)) };
    });

    const airPolicy = {
      surface,
      maximumMembers: 16,
      maximumRoostSites: Math.max(64, birdRoostSites.length + 10),
      maximumSpeedMps: 5,
      maximumAccelerationMps2: 6,
      maximumSubstepDistanceM: 0.4,
      maximumSubsteps: 10,
      minimumAltitudeM: 2.2,
      maximumAltitudeM: 6.5,
      preferredAltitudeM: 3.8,
      flightBehavior: 'boid3d' as const,
      flightAltitudeSpreadM: 1.4,
      separationRadiusM: 1.5,
      separationWeight: 2.0,
      cohesionWeight: 0.4,
      alignmentWeight: 0.45,
      targetWeight: 1.1,
      arrivalRadiusM: 0.45,
      holdingRadiusM: 3.2,
      holdingSpeedMps: 1.8,
      roostSlotSpacingM: 0.5,
      obstacles: adapted.obstacles,
    };

    const birdDefinitions: AnimalAirFlockCycleDefinition[] = Array.from({ length: groupCount }, (_, index) => {
      const angle = index * (Math.PI * 2 / groupCount);
      const flightOffset = add(scale(home.tangentU, Math.cos(angle) * 7 * factor), scale(home.tangentV, Math.sin(angle) * 7 * factor));
      const flightGround = surface.sample(surface.moveAlongSurface(home.position, flightOffset, 1));
      const flightTarget = add(flightGround.position, scale(flightGround.surfaceUp, 4.5));
      return {
        groupId: `${shape}-${size}-birds-${index}`,
        memberCount: 6,
        roostSites: birdRoostSites,
        flightTarget,
        roostDurationS: 6,
        flightDurationS: 12,
        returnDurationS: 12,
        fixedStepSeconds: 0.1,
        maximumReplaySteps: 400,
        policy: airPolicy,
      };
    });

    // Water & Fish configuration
    const water = this.makeWater(shape, factor);
    const fishHome = this.fishHomePosition(shape, factor);
    const fishSample = water.sample(fishHome, 0);
    const hasSafeWater = fishSample.containsWater && !!fishSample.bottom;

    if (!hasSafeWater) {
      this.status.update(status => ({ ...status, [shape]: 'fish fixture outside water' }));
    }

    const fishPlaybacks: ReturnType<typeof createAnimalAquaticSchoolCyclePlayback>[] = [];
    if (hasSafeWater) {
      const aquaticPolicy = {
        water,
        maximumMembers: 16,
        maximumZones: 16,
        maximumZoneDistanceM: Math.max(20, 15 * factor),
        minimumZoneSuitability01: 0.3,
        maximumSpeedMps: 2.4,
        maximumAccelerationMps2: 4,
        maximumSubstepDistanceM: 0.3,
        maximumSubsteps: 8,
        minimumSurfaceClearanceM: 0.7,
        minimumBottomClearanceM: 0.7,
        preferredSurfaceClearanceM: 1.4,
        maximumSurfaceClearanceM: 2.3,
        segmentSampleSpacingM: 0.25,
        separationRadiusM: 1.1,
        separationWeight: 2.5,
        cohesionWeight: 0.55,
        alignmentWeight: 0.45,
        targetWeight: 1.2,
        flowWeight: 0.1,
        depthWeight: 1.2,
        arrivalRadiusM: 0.35,
        slotSpacingM: 0.6,
        loiterRadiusM: 1.2,
        loiterAngularSpeedRadPerSecond: 0.7,
        maximumAvoidanceAttempts: 4,
      };

      const fishGroups = size === 'small' ? 2 : size === 'medium' ? 4 : 6;
      for (let index = 0; index < fishGroups; index++) {
        const homeZonePos = this.fishOffset(shape, factor, fishHome, index * 2.5);
        const forageZonePos = this.fishOffset(shape, factor, fishHome, (index + 2) * 2.8);
        const homeZone = { id: `${shape}-fish-home-${index}`, position: homeZonePos, radiusM: 2.2, capacity: 8, suitability01: 1 };
        const feedingZone = { id: `${shape}-fish-feed-${index}`, position: forageZonePos, radiusM: 2.2, capacity: 8, suitability01: 0.9 };
        const fishDefinition: AnimalAquaticSchoolCycleDefinition = {
          groupId: `${shape}-${size}-fish-${index}`,
          groupSeed: 0x5eed + index * 17 + shape.length,
          memberCount: 6,
          homeZone,
          feedingZones: [feedingZone],
          schoolingDurationS: 6,
          outboundDurationS: 10,
          feedingDurationS: 10,
          returnDurationS: 12,
          fixedStepSeconds: 0.1,
          maximumReplaySteps: 400,
          policy: aquaticPolicy,
        };
        fishPlaybacks.push(createAnimalAquaticSchoolCyclePlayback(fishDefinition));
      }
    }

    const totalAnimals = herdDefinitions.reduce((sum, d) => sum + d.memberCount, 0);
    const totalBirds = birdDefinitions.reduce((sum, d) => sum + d.memberCount, 0);
    const totalFish = fishPlaybacks.length * 6;

    const animals = Array.from({ length: totalAnimals }, () => {
      const animal = new Mesh(this.animalGeometry, this.animalMaterial);
      root.add(animal);
      return animal;
    });

    const birds = Array.from({ length: totalBirds }, () => {
      const bird = new Mesh(this.birdGeometry, this.birdMaterial);
      root.add(bird);
      return bird;
    });

    const fish = Array.from({ length: totalFish }, () => {
      const fishMesh = new Mesh(this.fishGeometry, this.fishMaterial);
      root.add(fishMesh);
      return fishMesh;
    });

    return {
      shape, size, label, root, surface, water,
      playbacks: herdDefinitions.map(createAnimalLandHerdCyclePlayback),
      birdPlaybacks: birdDefinitions.map(createAnimalAirFlockCyclePlayback),
      fishPlaybacks,
      animals, birds, fish, trees,
    };
  }

  private makeWater(shape: Shape, factor = 1): AnimalWaterVolume {
    const terrain = new TerrainAnimalWorldSurface(
      new ConstantTerrainField(-WATER_DEPTH_M),
      shape === 'plane'
        ? new PlaneTerrainDomain(20 * factor)
        : shape === 'sphere'
          ? new SphereTerrainDomain(8 * factor)
          : new CylinderTerrainDomain({ radiusM: 8 * factor, lengthM: 16 * factor }),
    );
    const surface: WaterSurface = {
      getHeight: () => 0,
      getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
      getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.15, 0, 0.05),
    };
    const domain = shape === 'plane'
      ? new PlaneWaterDomain()
      : shape === 'sphere'
        ? new SphereWaterDomain(8 * factor)
        : new CylinderWaterDomain(8 * factor, { axis: new Vector3(1, 0, 0), lengthM: 16 * factor });

    return new TerrainWaterAnimalVolume({
      terrain,
      bodies: [{ body: { id: `${shape}-water`, domain, surface } }],
    });
  }

  private fishHomePosition(shape: Shape, factor = 1): AnimalVector3 {
    if (shape === 'plane') {
      return { x: 0, y: -FISH_DEPTH_M, z: 0 };
    }
    if (shape === 'sphere') {
      return { x: 8 * factor - FISH_DEPTH_M, y: 0, z: 0 };
    }
    return { x: 0, y: 8 * factor + FISH_DEPTH_M, z: 0 };
  }

  private fishOffset(shape: Shape, factor: number, home: AnimalVector3, distance: number): AnimalVector3 {
    if (shape === 'plane') {
      return { x: home.x + Math.sin(distance) * 4 * factor, y: -FISH_DEPTH_M, z: home.z + Math.cos(distance) * 4 * factor };
    }
    if (shape === 'sphere') {
      const radius = 8 * factor - FISH_DEPTH_M;
      const angle = (distance / (8 * factor));
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: home.z };
    }
    return { x: home.x + distance, y: 8 * factor + FISH_DEPTH_M, z: home.z };
  }

  private makeTerrain(shape: Shape, factor = 1, field?: ITerrainField): Mesh {
    if (shape === 'sphere') {
      const mesh = new Mesh(new SphereGeometry(8 * factor, 48, 28), new MeshStandardMaterial({ color: '#4a6f43', roughness: 0.9 }));
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const length = Math.hypot(x, y, z) || 1;
        const relief = field?.sample([x, y, z]).elevationM ?? 0;
        positions.setXYZ(i, x + (x / length) * relief, y + (y / length) * relief, z + (z / length) * relief);
      }
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      return mesh;
    }
    if (shape === 'cylinder') {
      const mesh = new Mesh(
        new CylinderGeometry(8 * factor, 8 * factor, 16 * factor, 48, 24, true),
        new MeshStandardMaterial({ color: '#4a6f43', roughness: 0.9, side: BackSide }),
      );
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const radial = Math.hypot(y, z) || 1;
        const relief = field?.sample([x, y, z]).elevationM ?? 0;
        positions.setXYZ(i, x, y + (y / radial) * relief, z + (z / radial) * relief);
      }
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.rotation.z = Math.PI / 2;
      return mesh;
    }
    const geometry = new PlaneGeometry(20 * factor, 20 * factor, 32, 32);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      positions.setY(i, field?.sample([x, 0, z]).elevationM ?? 0);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return new Mesh(geometry, new MeshStandardMaterial({ color: '#4a6f43', roughness: 0.9 }));
  }

  private makeWaterMesh(shape: Shape, factor = 1): Mesh {
    if (shape === 'sphere') {
      return new Mesh(new SphereGeometry(8 * factor, 32, 20), this.waterMaterial);
    }
    if (shape === 'cylinder') {
      const mesh = new Mesh(
        new CylinderGeometry(8 * factor, 8 * factor, 16 * factor, 36, 1, true),
        new MeshStandardMaterial({ color: '#3888b5', transparent: true, opacity: 0.4, roughness: 0.2, side: BackSide }),
      );
      mesh.rotation.z = Math.PI / 2;
      return mesh;
    }
    const mesh = new Mesh(new PlaneGeometry(20 * factor, 20 * factor), this.waterMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0;
    return mesh;
  }

  private patchMesh(patch: AnimalGrazingPatch, surface: AnimalWorldSurface): Mesh {
    const mesh = new Mesh(
      new CylinderGeometry(patch.radiusM, patch.radiusM, 0.04, 24),
      new MeshStandardMaterial({ color: '#88a848', transparent: true, opacity: 0.4 }),
    );
    const frame = surface.sample(patch.position);
    mesh.position.set(frame.position.x, frame.position.y, frame.position.z);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z),
    ));
    mesh.position.add(new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).multiplyScalar(0.025));
    return mesh;
  }

  private render(time: number): void {
    const statuses = { ...this.status() };
    const activeShape = this.selectedShape();
    const activeSize = this.worldSize();

    for (const view of this.views) {
      if (view.shape !== activeShape || view.size !== activeSize) continue;

      let animalIndex = 0;
      let birdIndex = 0;
      let fishIndex = 0;
      let herdPhase = '';
      let birdPhase = '';
      let fishPhase = '';

      view.playbacks.forEach(playback => {
        const snapshot = playback.sample(time);
        herdPhase = snapshot.phase;
        snapshot.members.forEach(member => {
          if (animalIndex < view.animals.length) {
            this.renderAnimal(view, view.animals[animalIndex++], member);
          }
        });
      });

      view.birdPlaybacks.forEach(playback => {
        const snapshot = playback.sample(time);
        birdPhase = snapshot.phase;
        snapshot.members.forEach(member => {
          if (birdIndex < view.birds.length) {
            this.renderBird(view, view.birds[birdIndex++], member);
          }
        });
      });

      view.fishPlaybacks.forEach(playback => {
        const snapshot = playback.sample(time);
        fishPhase = snapshot.phase;
        snapshot.members.forEach(member => {
          if (fishIndex < view.fish.length) {
            this.renderFish(view, view.fish[fishIndex++], member, time);
          }
        });
      });

      statuses[view.shape] = `${view.size}: herds [${herdPhase}] · birds [${birdPhase}] · fish [${fishPhase || 'inactive'}] · ${view.playbacks.length} herds, ${view.birdPlaybacks.length} flocks, ${view.fishPlaybacks.length} schools`;
    }

    this.status.set(statuses);
  }

  private renderAnimal(view: View, mesh: Mesh, member: AnimalLandHerdMember): void {
    const frame = view.surface.sample(member.position);
    mesh.position.set(
      member.position.x + frame.surfaceUp.x * 0.35,
      member.position.y + frame.surfaceUp.y * 0.35,
      member.position.z + frame.surfaceUp.z * 0.35,
    );
    const up = new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).normalize();
    const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);
    const forward = vel.lengthSq() > 1e-6
      ? vel.normalize()
      : new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).normalize();

    const right = new Vector3().crossVectors(up, forward).normalize();
    const correctedForward = new Vector3().crossVectors(right, up).normalize();
    mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, correctedForward));
  }

  private renderBird(view: View, mesh: Mesh, member: AnimalAirFlockMember): void {
    mesh.position.set(member.position.x, member.position.y, member.position.z);
    const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);

    if (vel.lengthSq() > 1e-4) {
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vel.normalize());
      return;
    }

    const frame = view.surface.sample(member.position);
    const up = new Vector3(frame.surfaceUp.x, frame.surfaceUp.y, frame.surfaceUp.z).normalize();
    const yawAngle = stableBirdYaw(member.id);
    const tangent = new Vector3(frame.tangentU.x, frame.tangentU.y, frame.tangentU.z).applyAxisAngle(up, yawAngle);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
  }

  private renderFish(view: View, mesh: Mesh, member: AnimalAquaticSchoolMember, time: number): void {
    mesh.position.set(member.position.x, member.position.y, member.position.z);
    const vel = new Vector3(member.velocity.x, member.velocity.y, member.velocity.z);

    if (vel.lengthSq() > 1e-4) {
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vel.normalize());
      return;
    }

    const sample = view.water.sample(member.position, time);
    if (sample.bottom) {
      mesh.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(sample.bottom.tangentU.x, sample.bottom.tangentU.y, sample.bottom.tangentU.z).normalize(),
      );
    }
  }
}

function scale(value: AnimalVector3, factor: number): AnimalVector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function add(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function stableBirdYaw(id: string): number {
  return animalUnit(0x42, `yaw:${id}`) * Math.PI * 2;
}

class TerrainCheckpointField extends ConstantTerrainField {
  constructor(private readonly scaleFactor = 1) {
    super(0);
  }

  override sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const scale = Math.max(1, this.scaleFactor);
    return {
      elevationM: (Math.sin(x / (7 * scale)) * 0.45 + Math.cos(z / (8 * scale)) * 0.35) * Math.min(2, scale * 0.8),
    };
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
