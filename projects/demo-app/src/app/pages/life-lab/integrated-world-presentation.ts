import {
  BufferGeometry,
  BufferAttribute,
  ConeGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import {
  PlaneTerrainDomain,
  generateTerrainPatchMesh,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  buildScatterInstancedMesh,
  generateTerrainScatterInstances,
  type IScatterSurfaceSample,
  type ScatterPlacementRules,
} from 'triangular-engine/scatter';
import { LifeSimulation } from 'triangular-engine/life';
import { ProceduralAnimalPresentation } from './procedural-animal-presentation';

const PATCH_SIZE_M = 48;
const PATCH_RADIUS = 2;
const TERRAIN_RESOLUTION = 20;

type IntegratedHabitat = 'land' | 'water' | 'air' | 'unsuitable';

interface IntegratedCreatureProfile {
  habitat: Exclude<IntegratedHabitat, 'unsuitable'>;
  altitudeM: number;
  color: string;
}

interface IntegratedHabitatSample {
  kind: IntegratedHabitat;
  landSuitability01: number;
  waterSuitability01: number;
}

/** A deliberately small integrated world: enough space for several biomes and migration routes. */
export class IntegratedWorldPresentation {
  readonly group = new Group();
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private field: ITerrainField;
  private habitatGrid: IntegratedHabitatGrid;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly migration = new Group();
  private readonly habitatOverlay = new Group();
  private readonly travelers: Mesh[] = [];
  private readonly travelerProfiles: IntegratedCreatureProfile[] = [];
  private readonly travelerStates: Vector3[] = [];
  private readonly birdVisualSimulation = new LifeSimulation();
  private readonly fishVisualSimulation = new LifeSimulation();
  private readonly herdVisualSimulation = new LifeSimulation();
  // Four birds plus four tiny winged insects share the instanced wing rig.
  private readonly animalPresentation = new ProceduralAnimalPresentation(8, 4, 4);
  private readonly routePoints: Vector3[] = [];
  private readonly landRoutePoints: Vector3[] = [];
  private seed: number;
  private lastUpdateTimeSeconds = 0;

  constructor(seed = 909) {
    this.seed = seed;
    this.field = new IntegratedWorldField(seed);
    this.habitatGrid = new IntegratedHabitatGrid(this.field);
    this.group.name = 'life-lab-integrated-world';
    this.animalPresentation.setAllVisibility('relief');
    this.animalPresentation.setInsectStartIndex(4);
    this.group.add(this.animalPresentation.group);
    this.buildTerrain();
    this.buildWaterSurface();
    this.buildHabitatOverlay();
    this.buildMigrationRoute();
    this.buildScatter();
    if (!this.animalPresentation.group.parent) this.group.add(this.animalPresentation.group);
  }

  /** Rebuild the small world deterministically from a new scenario seed. */
  setSeed(seed: number): void {
    this.clearResources();
    this.seed = seed;
    this.field = new IntegratedWorldField(seed);
    this.habitatGrid = new IntegratedHabitatGrid(this.field);
    this.buildTerrain();
    this.buildWaterSurface();
    this.buildHabitatOverlay();
    this.buildMigrationRoute();
    this.buildScatter();
    if (!this.animalPresentation.group.parent) this.group.add(this.animalPresentation.group);
  }

  setHabitatOverlayVisible(visible: boolean): void {
    this.habitatOverlay.visible = visible;
  }

  update(timeSeconds: number): void {
    // High warp can advance many seconds between render frames. Simulate that
    // interval in bounded substeps so target sampling and shoreline checks do
    // not alias into back-and-forth motion or tunnel through water.
    const deltaSeconds = Math.max(0, timeSeconds - this.lastUpdateTimeSeconds);
    this.lastUpdateTimeSeconds = timeSeconds;
    const stepCount = Math.min(24, Math.max(1, Math.ceil(deltaSeconds / 0.08)));
    const stepSeconds = deltaSeconds / stepCount;
    for (let step = 0; step < stepCount; step++) {
      this.updateStep(timeSeconds - deltaSeconds + stepSeconds * (step + 1), stepSeconds);
    }
  }

  private updateStep(timeSeconds: number, stepSeconds: number): void {
    for (let index = 0; index < this.travelers.length; index++) {
      const profile = this.travelerProfiles[index];
      const state = this.travelerStates[index];
      const phase = index * 1.73 + this.seed * 0.017;
      const t = timeSeconds * (profile.habitat === 'air' ? 0.12 : 0.07) + phase;
      // Broad, low-frequency wandering targets keep the POC readable without
      // turning the animals into a train following a spline.
      let targetX = Math.sin(t * 0.37) * 150 + Math.sin(t * 0.11 + phase) * 42;
      let targetZ = Math.cos(t * 0.29 + phase) * 105 + Math.sin(t * 0.17) * 55;
      if (profile.habitat === 'land') {
        if (this.habitatGrid.sample(targetX, targetZ).kind !== 'land') {
          let foundLand = false;
          // Search outward around the free-wander target. Scaling toward the
          // origin biases every animal into one small area and still fails if
          // that area is water; a radial search preserves the open movement.
          for (const radius of [12, 24, 36, 48, 64]) {
            for (let sampleIndex = 0; sampleIndex < 16; sampleIndex++) {
              const angle = sampleIndex * (Math.PI * 2 / 16);
              const candidateX = targetX + Math.cos(angle) * radius;
              const candidateZ = targetZ + Math.sin(angle) * radius;
              if (this.habitatGrid.sample(candidateX, candidateZ).kind === 'land') {
                targetX = candidateX;
                targetZ = candidateZ;
                foundLand = true;
                break;
              }
            }
            if (foundLand) break;
          }
          if (!foundLand) {
            targetX = state.x;
            targetZ = state.z;
          }
        }
      } else if (profile.habitat === 'water') {
        for (let attempt = 0; attempt < 8 && this.habitatGrid.sample(targetX, targetZ).kind !== 'water'; attempt++) {
          targetX += Math.sin(phase + attempt) * 18;
          targetZ += Math.cos(phase * 0.7 + attempt) * 14;
        }
      }
      const terrain = this.field.sample([targetX, 0, targetZ]).elevationM;
      const targetY = profile.habitat === 'land'
        ? Math.max(terrain + profile.altitudeM, 0.7)
        : profile.habitat === 'water'
          ? -1.4 + Math.sin(t * 0.8 + phase) * 0.45
          : terrain + profile.altitudeM;
      const target = new Vector3(targetX, targetY, targetZ);
      const blend = Math.min(1, 1 - Math.exp(-(profile.habitat === 'air' ? 0.8 : 0.5) * stepSeconds));
      const previous = state.clone();
      state.lerp(target, blend);
      const maxStep = stepSeconds * (profile.habitat === 'land' ? 7.5 : profile.habitat === 'water' ? 12 : 17);
      const dx = state.x - previous.x;
      const dy = state.y - previous.y;
      const dz = state.z - previous.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > maxStep) {
        const scale = maxStep / distance;
        state.copy(previous).addScaledVector(new Vector3(dx, dy, dz), scale);
      }

      if (profile.habitat === 'land') {
        // Ground from the creature's actual x/z position, not only from its
        // target. This prevents interpolation across slopes from tunnelling
        // underground or hovering above the surface.
        const currentHabitat = this.habitatGrid.sample(state.x, state.z);
        if (currentHabitat.kind !== 'land') {
          // Never let a land agent cross the habitat boundary. Find the last
          // valid point along this frame's attempted step so it stops at the
          // shoreline without visibly snapping backwards.
          let low = 0;
          let high = 1;
          for (let iteration = 0; iteration < 7; iteration++) {
            const middle = (low + high) * 0.5;
            const candidateX = previous.x + (state.x - previous.x) * middle;
            const candidateZ = previous.z + (state.z - previous.z) * middle;
            if (this.habitatGrid.sample(candidateX, candidateZ).kind === 'land') {
              low = middle;
            } else {
              high = middle;
            }
          }
          state.x = previous.x + (state.x - previous.x) * low;
          state.z = previous.z + (state.z - previous.z) * low;
        }
        const surfaceElevation = this.field.sample([state.x, 0, state.z]).elevationM;
        state.y = surfaceElevation + profile.altitudeM;
      }
      this.travelers[index].position.copy(state);
      this.travelers[index].rotation.y = Math.atan2(state.x - previous.x, state.z - previous.z);
      const visualAgent = profile.habitat === 'air'
        ? this.birdVisualSimulation.agents[this.visualIndex(index, 'air')]
        : profile.habitat === 'water'
          ? this.fishVisualSimulation.agents[this.visualIndex(index, 'water')]
          : this.herdVisualSimulation.agents[this.visualIndex(index, 'land')];
      if (visualAgent) {
        visualAgent.position.x = state.x;
        visualAgent.position.y = state.y;
        visualAgent.position.z = state.z;
        visualAgent.velocity.x = state.x - previous.x;
        visualAgent.velocity.y = state.y - previous.y;
        visualAgent.velocity.z = state.z - previous.z;
      }
    }
    this.animalPresentation.updateHerd(this.herdVisualSimulation, timeSeconds);
    this.animalPresentation.updateBirds(this.birdVisualSimulation, timeSeconds);
    this.animalPresentation.updateFish(this.fishVisualSimulation, timeSeconds);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.animalPresentation.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private buildTerrain(): void {
    const terrainMaterial = this.track(new MeshStandardMaterial({
      color: '#607d55',
      roughness: 1,
      flatShading: true,
    }));
    for (let z = -PATCH_RADIUS; z <= PATCH_RADIUS; z++) {
      for (let x = -PATCH_RADIUS; x <= PATCH_RADIUS; x++) {
        const address = { level: 0, x, z };
        const patch = generateTerrainPatchMesh(this.field, this.domain, {
          address,
          resolution: TERRAIN_RESOLUTION,
        }) as ITerrainPatchMesh<typeof address>;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', this.attribute(patch.surface.positions, 3));
        geometry.setAttribute('normal', this.attribute(patch.surface.normals, 3));
        geometry.setAttribute('uv', this.attribute(patch.surface.uvs, 2));
        geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
        geometry.computeBoundingSphere();
        this.geometries.push(geometry);
        const mesh = new Mesh(geometry, terrainMaterial);
        mesh.position.set(
          patch.centerWorldM[0],
          patch.centerWorldM[1],
          patch.centerWorldM[2],
        );
        this.group.add(mesh);
      }
    }
  }

  private buildWaterSurface(): void {
    // A simple datum plane makes low-elevation water visible in the POC.
    // Terrain above it occludes the surface; valleys reveal the water habitat.
    const geometry = this.trackGeometry(new PlaneGeometry(420, 300));
    const material = this.track(new MeshStandardMaterial({
      color: '#3d83a3',
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }));
    const water = new Mesh(geometry, material);
    water.name = 'integrated-world-water-habitat';
    water.rotation.x = -Math.PI / 2;
    this.group.add(water);
  }

  private buildHabitatOverlay(): void {
    this.habitatOverlay.clear();
    this.habitatOverlay.name = 'integrated-world-habitat-debug-overlay';
    this.habitatOverlay.visible = false;
    const tileGeometry = this.trackGeometry(new PlaneGeometry(11, 11));
    const landMaterial = this.track(new MeshStandardMaterial({
      color: '#a8c46a', transparent: true, opacity: 0.08, depthWrite: false,
    }));
    const waterMaterial = this.track(new MeshStandardMaterial({
      color: '#4c9fc3', transparent: true, opacity: 0.16, depthWrite: false,
    }));
    for (let z = -6; z <= 6; z++) {
      for (let x = -9; x <= 9; x++) {
        const worldX = x * 12 + 6;
        const worldZ = z * 12 + 6;
        const sample = this.habitatGrid.sample(worldX, worldZ);
        const elevation = this.field.sample([worldX, 0, worldZ]).elevationM;
        const tile = new Mesh(tileGeometry, sample.kind === 'water' ? waterMaterial : landMaterial);
        tile.position.set(worldX, Math.max(elevation, 0) + 0.65, worldZ);
        tile.rotation.x = -Math.PI / 2;
        this.habitatOverlay.add(tile);
      }
    }
    this.group.add(this.habitatOverlay);
  }

  private buildScatter(): void {
    const rules: ScatterPlacementRules = {
      alignment: 'align-to-surface-up',
      slopeMax01: 0.7,
      embedDepthM: 0.2,
    };
    const trees = [];
    const meadow = [];
    for (let z = -PATCH_RADIUS; z <= PATCH_RADIUS; z++) {
      for (let x = -PATCH_RADIUS; x <= PATCH_RADIUS; x++) {
        const address = { level: 0, x, z };
        const base = {
          field: this.field,
          domain: this.domain,
          cellAddress: address,
          cellKey: `world:${x}:${z}`,
          identity: { worldSeed: this.seed, layerId: 'integrated-life', speciesId: 'forest-meadow', generatorVersion: 1 },
          rules,
          candidatePoolSize: 30,
        } as const;
        trees.push(...generateTerrainScatterInstances({
          ...base,
          baseDensity01: this.biomeDensity(x, z, 'forest'),
          suitability: (sample: IScatterSurfaceSample) => this.habitatGrid.sample(sample.worldPositionM[0], sample.worldPositionM[2]).landSuitability01 * (sample.elevationM > 4 && sample.elevationM < 28 ? 1 : 0),
        }));
        meadow.push(...generateTerrainScatterInstances({
          ...base,
          identity: { ...base.identity, speciesId: 'meadow-tuft' },
          baseDensity01: this.biomeDensity(x, z, 'meadow'),
          suitability: (sample: IScatterSurfaceSample) => this.habitatGrid.sample(sample.worldPositionM[0], sample.worldPositionM[2]).landSuitability01 * (sample.elevationM < 16 ? 1 : 0),
        }));
      }
    }
    const treeGeometry = this.trackGeometry(new ConeGeometry(2.4, 10, 6));
    const meadowGeometry = this.trackGeometry(new ConeGeometry(0.35, 1.8, 4));
    this.group.add(buildScatterInstancedMesh({
      instances: trees,
      geometry: treeGeometry,
      material: this.track(new MeshStandardMaterial({ color: '#2f5b36', roughness: 1 })),
      rules,
      scale: { min: 0.7, max: 1.5 },
      anchorWorldM: [0, 0, 0],
    }));
    this.group.add(buildScatterInstancedMesh({
      instances: meadow,
      geometry: meadowGeometry,
      material: this.track(new MeshStandardMaterial({ color: '#8ca85a', roughness: 1 })),
      rules,
      scale: { min: 0.7, max: 1.3 },
      anchorWorldM: [0, 0, 0],
    }));
    this.buildRockBlockers(rules);
  }

  private buildRockBlockers(rules: ScatterPlacementRules): void {
    const rocks = [];
    for (let z = -PATCH_RADIUS; z <= PATCH_RADIUS; z++) {
      for (let x = -PATCH_RADIUS; x <= PATCH_RADIUS; x++) {
        const address = { level: 0, x, z };
        const base = {
          field: this.field,
          domain: this.domain,
          cellAddress: address,
          cellKey: `rocks:${this.seed}:${x}:${z}`,
          identity: { worldSeed: this.seed, layerId: 'integrated-rocks', speciesId: 'large-rock', generatorVersion: 1 },
          rules: { ...rules, embedDepthM: 0.35 },
          candidatePoolSize: 8,
        } as const;
        rocks.push(...generateTerrainScatterInstances({
          ...base,
          baseDensity01: 0.22,
          suitability: (sample: IScatterSurfaceSample) => {
            // Keep the migration corridor open; rocks still form natural
            // blockers elsewhere in the terrain.
            const clearOfRoute = this.distanceToRoute(sample.worldPositionM[0], sample.worldPositionM[2]) > 9;
            return this.habitatGrid.sample(sample.worldPositionM[0], sample.worldPositionM[2]).landSuitability01 * (clearOfRoute ? 1 : 0);
          },
        }));
      }
    }
    this.group.add(buildScatterInstancedMesh({
      instances: rocks,
      geometry: this.trackGeometry(new DodecahedronGeometry(3.2, 0)),
      material: this.track(new MeshStandardMaterial({ color: '#716b63', roughness: 1, flatShading: true })),
      rules: { ...rules, embedDepthM: 0.35 },
      scale: { min: 0.8, max: 1.8 },
      anchorWorldM: [0, 0, 0],
    }));
  }

  private buildMigrationRoute(): void {
    this.routePoints.length = 0;
    this.landRoutePoints.length = 0;
    const routePhase = this.seed * 0.019;
    // A closed route is a useful baseline for migration: it never needs to
    // despawn agents at an endpoint. The seed changes its shape while the
    // terrain sample keeps every point above the generated land surface.
    for (let index = 0; index < 40; index++) {
      const t = index / 40;
      const angle = t * Math.PI * 2;
      const baseX = Math.cos(angle + routePhase * 0.15) * (58 + Math.sin(routePhase) * 8);
      const baseZ = Math.sin(angle) * (28 + Math.cos(routePhase * 0.7) * 7) + Math.sin(angle * 2 + routePhase) * 7;
      const elevation = this.field.sample([baseX, 0, baseZ]).elevationM;
      this.routePoints.push(new Vector3(baseX, elevation + 0.4, baseZ));
      const landX = Math.cos(angle + routePhase * 0.08) * 24;
      // Keep the demo land corridor on the broad northern meadow. The
      // eventual habitat corridor solver will choose this from the grid.
      const landZ = -20 + Math.sin(angle) * 8 + Math.sin(angle * 2 + routePhase * 0.5) * 2;
      const landElevation = this.field.sample([landX, 0, landZ]).elevationM;
      this.landRoutePoints.push(new Vector3(landX, Math.max(landElevation, 0.3) + 0.4, landZ));
    }
    const points = [...this.routePoints, this.routePoints[0]];
    const routeGeometry = new BufferGeometry().setFromPoints(points);
    this.geometries.push(routeGeometry);
    // Keep route geometry as a debug aid for obstacle seeding, but do not
    // present it as the animal behaviour. The acceptance target is free life.
    const landPoints = [...this.landRoutePoints, this.landRoutePoints[0]];
    const landRouteGeometry = new BufferGeometry().setFromPoints(landPoints);
    this.geometries.push(landRouteGeometry);
    const travelerGeometry = this.trackGeometry(new ConeGeometry(0.7, 2.4, 4));
    const profiles: IntegratedCreatureProfile[] = [
      { habitat: 'land', altitudeM: 2, color: '#a96b45' },
      { habitat: 'land', altitudeM: 2, color: '#a96b45' },
      { habitat: 'land', altitudeM: 2, color: '#a96b45' },
      { habitat: 'land', altitudeM: 2, color: '#a96b45' },
      { habitat: 'air', altitudeM: 10, color: '#f0d26a' },
      { habitat: 'air', altitudeM: 10, color: '#f0d26a' },
      { habitat: 'air', altitudeM: 10, color: '#f0d26a' },
      { habitat: 'air', altitudeM: 10, color: '#f0d26a' },
      { habitat: 'air', altitudeM: 8, color: '#d6a84b' },
      { habitat: 'air', altitudeM: 8, color: '#d6a84b' },
      { habitat: 'air', altitudeM: 8, color: '#d6a84b' },
      { habitat: 'air', altitudeM: 8, color: '#d6a84b' },
      { habitat: 'water', altitudeM: -1.4, color: '#63b9c9' },
      { habitat: 'water', altitudeM: -1.4, color: '#63b9c9' },
      { habitat: 'water', altitudeM: -1.4, color: '#63b9c9' },
      { habitat: 'water', altitudeM: -1.4, color: '#63b9c9' },
    ];
    for (const profile of profiles) {
      this.travelerProfiles.push(profile);
      const traveler = new Mesh(travelerGeometry, this.track(new MeshStandardMaterial({ color: profile.color, roughness: 0.8 })));
      this.travelers.push(traveler);
      let startX = (this.seed * 0.17 + this.travelers.length * 19) % 180 - 90;
      let startZ = (this.seed * 0.11 + this.travelers.length * 27) % 120 - 60;
      if (profile.habitat === 'land' && this.habitatGrid.sample(startX, startZ).kind !== 'land') {
        for (const radius of [12, 24, 36, 48]) {
          let foundLand = false;
          for (let sampleIndex = 0; sampleIndex < 16; sampleIndex++) {
            const angle = sampleIndex * (Math.PI * 2 / 16);
            const candidateX = startX + Math.cos(angle) * radius;
            const candidateZ = startZ + Math.sin(angle) * radius;
            if (this.habitatGrid.sample(candidateX, candidateZ).kind === 'land') {
              startX = candidateX;
              startZ = candidateZ;
              foundLand = true;
              break;
            }
          }
          if (foundLand) break;
        }
      }
      this.travelerStates.push(new Vector3(
        startX,
        profile.habitat === 'air' ? 16 : profile.habitat === 'water' ? -1.4 : this.field.sample([startX, 0, startZ]).elevationM + profile.altitudeM,
        startZ,
      ));
      const visualSimulation = profile.habitat === 'air'
        ? this.birdVisualSimulation
        : profile.habitat === 'water'
          ? this.fishVisualSimulation
          : this.herdVisualSimulation;
      visualSimulation.addAgent({
        id: visualSimulation.agents.length,
        position: { x: this.travelerStates[this.travelerStates.length - 1].x, y: this.travelerStates[this.travelerStates.length - 1].y, z: this.travelerStates[this.travelerStates.length - 1].z },
        maxSpeed: 1,
      });
      traveler.visible = false;
      this.migration.add(traveler);
    }
    this.group.add(this.migration);
  }

  private biomeDensity(cellX: number, cellZ: number, biome: 'forest' | 'meadow'): number {
    const ridge = Math.sin(cellX * 0.9 + cellZ * 0.35 + this.seed * 0.013) * 0.5 + 0.5;
    if (biome === 'forest') return Math.max(0, Math.min(1, ridge * 1.4 - Math.abs(cellZ) * 0.12));
    return Math.max(0, Math.min(1, 1 - ridge * 0.75 + Math.abs(cellZ) * 0.08));
  }

  private distanceToRoute(x: number, z: number): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of this.landRoutePoints) {
      nearest = Math.min(nearest, Math.hypot(x - point.x, z - point.z));
    }
    return nearest;
  }

  private attribute(values: Float32Array, itemSize: number): BufferAttribute {
    return new Float32BufferAttribute(values, itemSize);
  }

  private track<T extends MeshStandardMaterial>(material: T): T { this.materials.push(material); return material; }
  private trackGeometry<T extends BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }

  private clearResources(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    this.travelers.length = 0;
    this.travelerProfiles.length = 0;
    this.travelerStates.length = 0;
    this.birdVisualSimulation.agents.length = 0;
    this.fishVisualSimulation.agents.length = 0;
    this.herdVisualSimulation.agents.length = 0;
    this.migration.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private visualIndex(index: number, habitat: IntegratedCreatureProfile['habitat']): number {
    let result = 0;
    for (let i = 0; i < index; i++) {
      if (this.travelerProfiles[i].habitat === habitat) result++;
    }
    return result;
  }

}

/** Coarse deterministic environment layer used before a full planetary grid exists. */
class IntegratedHabitatGrid {
  private readonly cellSizeM = 12;

  constructor(private readonly field: ITerrainField) {}

  sample(x: number, z: number, knownElevationM?: number): IntegratedHabitatSample {
    const cellX = Math.floor(x / this.cellSizeM) * this.cellSizeM + this.cellSizeM * 0.5;
    const cellZ = Math.floor(z / this.cellSizeM) * this.cellSizeM + this.cellSizeM * 0.5;
    const elevationM = knownElevationM ?? this.field.sample([cellX, 0, cellZ]).elevationM;
    const landSuitability01 = this.smoothStep(-1.5, 2.5, elevationM);
    const waterSuitability01 = 1 - this.smoothStep(-2.5, 1.5, elevationM);
    return {
      kind: landSuitability01 > 0.5 ? 'land' : waterSuitability01 > 0.5 ? 'water' : 'unsuitable',
      landSuitability01,
      waterSuitability01,
    };
  }

  private smoothStep(edge0: number, edge1: number, value: number): number {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
}

class IntegratedWorldField implements ITerrainField {
  readonly minElevationM = -8;
  readonly maxElevationM = 46;
  private readonly offset: number;

  constructor(seed: number) {
    this.offset = seed * 0.017;
  }

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const meadow = Math.sin(x / 21 + this.offset) * 3 + Math.cos(z / 28 - this.offset * 0.7) * 4;
    const ridge = Math.exp(-Math.pow((x + 42 + Math.sin(this.offset) * 12) / 32, 2)) * 28;
    const mountain = Math.exp(-Math.pow((x - 55 + Math.cos(this.offset) * 10) / 38, 2) - Math.pow((z + 8) / 55, 2)) * 34;
    const crater = -Math.exp(-Math.pow((x - 8) / 27, 2) - Math.pow((z - 24 + Math.sin(this.offset) * 8) / 24, 2)) * 12;
    return { elevationM: meadow + ridge + mountain + crater };
  }

  sampleBatch(positions: Float64Array, out = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.sample([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]).elevationM;
    return out;
  }
}
