import {
  CircleGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  type Material,
} from 'three';
import {
  planLifeRoute,
  chooseLifeActivityTarget,
  sampleLifeGroupAtTime,
  sampleLifeRouteAtTime,
  classifyLifeCellResidency,
  enumerateLifeCellsInRadius,
  lifeCellCenter,
  FOUR_SEASON_CYCLE,
  sampleLifeSeasonAtTime,
  sampleLifeSeasonResponse,
  sampleLifeCohortAtTime,
  type LifeDeterministicRoute,
  type LifeHabitatQuery,
  type LifeRouteSegment,
} from 'triangular-engine/life';

export type InspectorActivity =
  | 'grazing'
  | 'travelling-to-water'
  | 'drinking'
  | 'travelling-to-rest'
  | 'resting'
  | 'travelling-to-meadow';

export interface LifeWorldInspectorState {
  readonly activity: InspectorActivity;
  readonly herdX: number;
  readonly herdZ: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly targetId: string;
  readonly activeCells: number;
  readonly residentCells: number;
  readonly aggregateCells: number;
  readonly seasonId: string;
  readonly migrationPressure01: number;
  readonly juvenileCount: number;
  readonly adultCount: number;
  readonly deadCount: number;
}

/**
 * A deliberately top-down world diagnostic. It is not a terrain renderer or
 * population simulator: it makes deterministic habitat and high-level herd
 * state inspectable before we depend on 3D presentation.
 */
export class LifeWorldInspectorPresentation {
  readonly group = new Group();

  private readonly materials: Material[] = [];
  private readonly tileMaterials: MeshBasicMaterial[] = [];
  private readonly geometries: PlaneGeometry[] = [];
  private readonly dummy = new Object3D();
  private readonly herdMarker: Mesh;
  private readonly targetMarker: Mesh;
  private readonly cameraResidencyMarker: Mesh;
  private readonly aggregateResidencyMarker: Mesh;
  private readonly trackedResidencyMarker: Mesh;
  private readonly herdAnimals: InstancedMesh;
  private meadowToWater: LifeDeterministicRoute;
  private meadowToNorthWater: LifeDeterministicRoute;
  private winterMeadowToWater: LifeDeterministicRoute;
  private winterMeadowToNorthWater: LifeDeterministicRoute;
  private waterToShelter: LifeDeterministicRoute;
  private northWaterToShelter: LifeDeterministicRoute;
  private shelterToMeadow: LifeDeterministicRoute;
  private shelterToWinterMeadow: LifeDeterministicRoute;
  private inspectorSeed = 909;
  private readonly habitatQuery: LifeHabitatQuery = {
    sampleHabitat: (position) => ({
      kind: this.habitatAt(position.x, position.z, this.inspectorSeed),
      surfaceY: this.surfaceAt(position.x, position.z, this.inspectorSeed),
      suitability01: 1,
    }),
  };
  private readonly state: LifeWorldInspectorState = {
    activity: 'grazing',
    herdX: -58,
    herdZ: -28,
    targetX: -58,
    targetZ: -28,
    targetId: 'summer-meadow',
    activeCells: 0,
    residentCells: 0,
    aggregateCells: 0,
    seasonId: 'spring',
    migrationPressure01: 0,
    juvenileCount: 0,
    adultCount: 0,
    deadCount: 0,
  };

  constructor(seed = 909) {
    this.group.name = 'life-world-inspector';
    this.herdMarker = new Mesh(
      new RingGeometry(11.5, 12.6, 28),
      this.trackMaterial(new MeshBasicMaterial({ color: '#f2c35d', transparent: true, opacity: 0.98 })),
    );
    this.herdMarker.rotation.x = -Math.PI / 2;
    this.herdMarker.position.y = 0.5;
    this.targetMarker = new Mesh(
      new RingGeometry(4.8, 6.4, 20),
      this.trackMaterial(new MeshBasicMaterial({ color: '#f6e6a1', transparent: true, opacity: 0.9 })),
    );
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.y = 0.55;
    this.cameraResidencyMarker = this.residencyRing(20, '#73e6ef', 0.95);
    this.aggregateResidencyMarker = this.residencyRing(180, '#5f8bd8', 0.35);
    this.trackedResidencyMarker = this.residencyRing(16, '#f27b66', 0.9);
    this.herdAnimals = new InstancedMesh(
      new CircleGeometry(2.7, 3),
      this.trackMaterial(new MeshBasicMaterial({ color: '#2d1610', transparent: true, opacity: 1 })),
      20,
    );
    this.herdAnimals.name = 'life-world-inspector-herd-agents';
    this.herdAnimals.position.y = 0.6;
    this.group.add(
      this.aggregateResidencyMarker,
      this.cameraResidencyMarker,
      this.trackedResidencyMarker,
      this.herdMarker,
      this.targetMarker,
      this.herdAnimals,
    );
    this.meadowToWater = this.route({ x: -58, y: 0, z: -28 }, { x: 13, y: 0, z: 22 }, 40);
    this.meadowToNorthWater = this.route({ x: -58, y: 0, z: -28 }, { x: 31, y: 0, z: 20 }, 40);
    this.winterMeadowToWater = this.route({ x: -22, y: 0, z: -20 }, { x: 13, y: 0, z: 22 }, 40);
    this.winterMeadowToNorthWater = this.route({ x: -22, y: 0, z: -20 }, { x: 31, y: 0, z: 20 }, 40);
    this.waterToShelter = this.route({ x: 13, y: 0, z: 22 }, { x: -82, y: 0, z: 74 }, 60);
    this.northWaterToShelter = this.route({ x: 31, y: 0, z: 20 }, { x: -82, y: 0, z: 74 }, 60);
    this.shelterToMeadow = this.route({ x: -82, y: 0, z: 74 }, { x: -58, y: 0, z: -28 }, 50);
    this.shelterToWinterMeadow = this.route({ x: -82, y: 0, z: 74 }, { x: -22, y: 0, z: -20 }, 50);
    this.setSeed(seed);
  }

  get currentState(): LifeWorldInspectorState {
    return this.state;
  }

  setSeed(seed: number): void {
    this.inspectorSeed = seed;
    this.clearTiles();
    const cellSize = 10;
    const halfCells = 18;
    const capacity = (halfCells * 2 + 1) ** 2;
    const tileGeometry = this.trackGeometry(new PlaneGeometry(cellSize - 0.35, cellSize - 0.35));
    const land = this.createTileMesh(tileGeometry, '#6b8f57', capacity);
    const meadow = this.createTileMesh(tileGeometry, '#9fbd64', capacity);
    const forest = this.createTileMesh(tileGeometry, '#3e6548', capacity);
    const water = this.createTileMesh(tileGeometry, '#397da0', capacity);
    const meshes = { land, meadow, forest, water };
    const counts = { land: 0, meadow: 0, forest: 0, water: 0 };

    for (let z = -halfCells; z <= halfCells; z++) {
      for (let x = -halfCells; x <= halfCells; x++) {
        const worldX = x * cellSize;
        const worldZ = z * cellSize;
        const habitat = this.habitatAt(worldX, worldZ, seed);
        const mesh = meshes[habitat];
        this.dummy.position.set(worldX, 0, worldZ);
        this.dummy.rotation.set(-Math.PI / 2, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(counts[habitat]++, this.dummy.matrix);
      }
    }
    for (const habitat of ['land', 'meadow', 'forest', 'water'] as const) {
      meshes[habitat].count = counts[habitat];
      meshes[habitat].instanceMatrix.needsUpdate = true;
    }
    this.meadowToWater = this.route({ x: -58, y: 0, z: -28 }, { x: 13, y: 0, z: 22 }, 40);
    this.meadowToNorthWater = this.route({ x: -58, y: 0, z: -28 }, { x: 31, y: 0, z: 20 }, 40);
    this.winterMeadowToWater = this.route({ x: -22, y: 0, z: -20 }, { x: 13, y: 0, z: 22 }, 40);
    this.winterMeadowToNorthWater = this.route({ x: -22, y: 0, z: -20 }, { x: 31, y: 0, z: 20 }, 40);
    this.waterToShelter = this.route({ x: 13, y: 0, z: 22 }, { x: -82, y: 0, z: 74 }, 60);
    this.northWaterToShelter = this.route({ x: 31, y: 0, z: 20 }, { x: -82, y: 0, z: 74 }, 60);
    this.shelterToMeadow = this.route({ x: -82, y: 0, z: 74 }, { x: -58, y: 0, z: -28 }, 50);
    this.shelterToWinterMeadow = this.route({ x: -82, y: 0, z: 74 }, { x: -22, y: 0, z: -20 }, 50);
  }

  update(universalTimeSeconds: number): LifeWorldInspectorState {
    // Five calm, deterministic phases. The anchor is an activity area, rather
    // than a lead animal; individual markers move independently around it.
    const period = 320;
    const localTime = ((universalTimeSeconds % period) + period) % period;
    const seasonSample = sampleLifeSeasonAtTime(
      { ...FOUR_SEASON_CYCLE, yearLengthSeconds: period },
      universalTimeSeconds,
    );
    const seasonResponse = sampleLifeSeasonResponse(seasonSample, ['spring', 'summer']);
    const cohort = sampleLifeCohortAtTime({
      seed: this.inspectorSeed,
      count: 20,
      birthTimeSeconds: -80,
      birthSpreadSeconds: 120,
      juvenileDurationSeconds: 70,
      lifespanSeconds: 360,
    }, universalTimeSeconds);
    const winter = seasonSample.season.id === 'winter';
    const meadowTargets = [
      {
        id: 'summer-meadow',
        activity: 'graze' as const,
        position: { x: -58, y: 0, z: -28 },
        suitability01: winter ? 0.2 : 1,
      },
      {
        id: 'winter-meadow',
        activity: 'graze' as const,
        position: { x: -22, y: 0, z: -20 },
        suitability01: winter ? 1 : 0.2,
      },
    ];
    const selectedMeadow = chooseLifeActivityTarget(meadowTargets, {
      seed: this.inspectorSeed,
      universalTimeSeconds,
      minimumSuitability01: 0.5,
      decisionPeriodSeconds: period,
    }) ?? meadowTargets[0];
    const meadow = { x: selectedMeadow.position.x, z: selectedMeadow.position.z };
    // Drinking sites are shore targets, not lake-centre points. Suitability
    // chooses between them deterministically for the current season/UT.
    const waterTargets = [
      {
        id: 'east-shore',
        activity: 'drink' as const,
        position: { x: 13, y: 0, z: 22 },
        suitability01: winter ? 0.9 : 1,
      },
      {
        id: 'north-shore',
        activity: 'drink' as const,
        position: { x: 31, y: 0, z: 20 },
        suitability01: winter ? 1 : 0.9,
      },
    ];
    const selectedWater = chooseLifeActivityTarget(waterTargets, {
      seed: this.inspectorSeed + 17,
      universalTimeSeconds,
      minimumSuitability01: 0.5,
      decisionPeriodSeconds: period,
    }) ?? waterTargets[0];
    const water = { x: selectedWater.position.x, z: selectedWater.position.z };
    const shelter = { x: -82, z: 74 };
    const meadowToWater = winter ? this.winterMeadowToWater : this.meadowToWater;
    const meadowToSelectedWater = selectedWater.id === 'north-shore'
      ? (winter ? this.winterMeadowToNorthWater : this.meadowToNorthWater)
      : meadowToWater;
    const selectedWaterToShelter = selectedWater.id === 'north-shore'
      ? this.northWaterToShelter
      : this.waterToShelter;
    const shelterToMeadow = winter ? this.shelterToWinterMeadow : this.shelterToMeadow;
    let activity: InspectorActivity;
    let herd = meadow;
    let target = meadow;
    let activeRoute: LifeDeterministicRoute | undefined;
    let routeTime = 0;
    if (localTime < 105) {
      activity = 'grazing';
      target = meadow;
    } else if (localTime < 145) {
      activity = 'travelling-to-water';
      herd = this.routePosition(meadowToSelectedWater, localTime - 105);
      activeRoute = meadowToSelectedWater;
      routeTime = localTime - 105;
      target = water;
    } else if (localTime < 175) {
      activity = 'drinking';
      herd = water;
      target = water;
    } else if (localTime < 235) {
      activity = 'travelling-to-rest';
      herd = this.routePosition(selectedWaterToShelter, localTime - 175);
      activeRoute = selectedWaterToShelter;
      routeTime = localTime - 175;
      target = shelter;
    } else if (localTime < 270) {
      activity = 'resting';
      herd = shelter;
      target = shelter;
    } else {
      activity = 'travelling-to-meadow';
      herd = this.routePosition(shelterToMeadow, localTime - 270);
      activeRoute = shelterToMeadow;
      routeTime = localTime - 270;
      target = meadow;
    }
    Object.assign(this.state, {
      activity,
      herdX: herd.x,
      herdZ: herd.z,
      targetX: target.x,
      targetZ: target.z,
      targetId: activity === 'drinking' || activity === 'travelling-to-water'
        ? selectedWater.id
        : selectedMeadow.id,
      seasonId: seasonSample.season.id,
      migrationPressure01: seasonResponse.migrationPressure01,
      juvenileCount: cohort.juvenile,
      adultCount: cohort.adult,
      deadCount: cohort.dead,
    });
    const tracked = {
      x: Math.cos(universalTimeSeconds * 0.012) * 110,
      z: Math.sin(universalTimeSeconds * 0.012) * 110,
    };
    this.trackedResidencyMarker.position.set(tracked.x, 0.48, tracked.z);
    const policy = {
      cellSize: 10,
      cameraActiveDistance: 60,
      cameraAggregateDistance: 180,
      interactionDistance: 30,
      trackedDistance: 25,
    };
    let activeCells = 0;
    let residentCells = 0;
    let aggregateCells = 0;
    for (const cell of enumerateLifeCellsInRadius({ x: 0, y: 0, z: 0 }, 180, policy.cellSize)) {
      const residency = classifyLifeCellResidency(
        lifeCellCenter(cell, policy.cellSize),
        [
          { kind: 'camera', position: { x: 0, y: 0, z: 0 } },
          { kind: 'tracked', position: { x: tracked.x, y: 0, z: tracked.z } },
        ],
        policy,
      );
      if (residency === 'active') activeCells++;
      else if (residency === 'resident') residentCells++;
      else if (residency === 'aggregate') aggregateCells++;
    }
    Object.assign(this.state, { activeCells, residentCells, aggregateCells });
    this.herdMarker.position.set(herd.x, 0.5, herd.z);
    this.targetMarker.position.set(target.x, 0.55, target.z);
    this.updateHerdAnimals(universalTimeSeconds, herd, activeRoute, routeTime);
    return this.state;
  }

  dispose(): void {
    this.clearTiles();
    this.herdMarker.geometry.dispose();
    this.targetMarker.geometry.dispose();
    this.cameraResidencyMarker.geometry.dispose();
    this.aggregateResidencyMarker.geometry.dispose();
    this.trackedResidencyMarker.geometry.dispose();
    this.herdAnimals.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private habitatAt(x: number, z: number, seed: number): 'land' | 'meadow' | 'forest' | 'water' {
    const offset = (seed % 997) * 0.009;
    const lake = Math.pow((x - 54) / 39, 2) + Math.pow((z - 22) / 27, 2) < 1;
    if (lake) return 'water';
    const meadow = Math.pow((x + 58) / 56, 2) + Math.pow((z + 28) / 42, 2) < 1;
    if (meadow) return 'meadow';
    const forest = Math.sin(x * 0.035 + offset) + Math.cos(z * 0.029 - offset) > 1.18;
    return forest ? 'forest' : 'land';
  }

  private updateHerdAnimals(
    universalTimeSeconds: number,
    herd: { x: number; z: number },
    route: LifeDeterministicRoute | undefined,
    routeTime: number,
  ): void {
    const groupRoute = route ?? {
      segments: [{
        from: { x: herd.x, y: 0, z: herd.z },
        to: { x: herd.x, y: 0, z: herd.z },
        durationSeconds: 1,
      }],
    };
    const group = sampleLifeGroupAtTime({
      seed: this.inspectorSeed,
      count: this.herdAnimals.count,
      route: groupRoute,
      spread: 7,
      wanderAmplitude: 1.25,
      wanderPeriodSeconds: 15,
    }, route ? routeTime : universalTimeSeconds);
    for (let index = 0; index < group.members.length; index++) {
      const member = group.members[index];
      this.dummy.position.set(member.position.x, member.position.y, member.position.z);
      this.dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(member.heading.x, member.heading.z));
      this.dummy.updateMatrix();
      this.herdAnimals.setMatrixAt(index, this.dummy.matrix);
    }
    this.herdAnimals.instanceMatrix.needsUpdate = true;
  }

  private route(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, durationSeconds: number): LifeDeterministicRoute {
    const planned = planLifeRoute({
      query: this.habitatQuery,
      start: from,
      goal: to,
      allowedKinds: ['land', 'meadow', 'forest'],
      cellSize: 10,
      maxSearchNodes: 2048,
      travelSpeed: 2,
    });
    const segments = planned ?? [{ from, to, durationSeconds }];
    return { segments: this.retime(segments, durationSeconds) };
  }

  private retime(segments: readonly LifeRouteSegment[], durationSeconds: number): LifeRouteSegment[] {
    const total = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const scale = total > 1e-6 ? durationSeconds / total : 1;
    return segments.map((segment) => ({ ...segment, durationSeconds: segment.durationSeconds * scale }));
  }

  private surfaceAt(x: number, z: number, seed: number): number {
    const water = this.habitatAt(x, z, seed) === 'water';
    if (water) return -1;
    return Math.sin(x * 0.021 + seed * 0.01) * 1.4 + Math.cos(z * 0.017 - seed * 0.008) * 1.1;
  }

  private residencyRing(radius: number, color: string, opacity: number): Mesh {
    const marker = new Mesh(
      new RingGeometry(radius - 0.8, radius, 64),
      this.trackMaterial(new MeshBasicMaterial({ color, transparent: true, opacity })),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.45;
    return marker;
  }

  private routePosition(route: LifeDeterministicRoute, timeSeconds: number): { x: number; z: number } {
    const sample = sampleLifeRouteAtTime(route, timeSeconds);
    return { x: sample.position.x, z: sample.position.z };
  }

  private createTileMesh(geometry: PlaneGeometry, color: string, capacity: number): InstancedMesh {
    const material = new MeshBasicMaterial({ color });
    this.tileMaterials.push(material);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = `life-world-inspector-${color}`;
    this.group.add(mesh);
    return mesh;
  }

  private clearTiles(): void {
    const tiles = this.group.children.filter((child) => child instanceof InstancedMesh && child !== this.herdAnimals);
    for (const tile of tiles) this.group.remove(tile);
    for (const geometry of this.geometries.splice(0)) geometry.dispose();
    for (const material of this.tileMaterials.splice(0)) material.dispose();
  }

  private trackGeometry(geometry: PlaneGeometry): PlaneGeometry {
    this.geometries.push(geometry);
    return geometry;
  }

  private trackMaterial(material: MeshBasicMaterial): MeshBasicMaterial {
    this.materials.push(material);
    return material;
  }
}
