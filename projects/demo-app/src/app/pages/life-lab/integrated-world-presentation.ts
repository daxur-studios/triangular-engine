import {
  BufferGeometry,
  BufferAttribute,
  ConeGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
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

const PATCH_SIZE_M = 48;
const PATCH_RADIUS = 2;
const TERRAIN_RESOLUTION = 20;

/** A deliberately small integrated world: enough space for several biomes and migration routes. */
export class IntegratedWorldPresentation {
  readonly group = new Group();
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private field: ITerrainField;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly migration = new Group();
  private readonly travelers: Mesh[] = [];
  private readonly routePoints: Vector3[] = [];
  private readonly landRoutePoints: Vector3[] = [];
  private seed: number;

  constructor(seed = 909) {
    this.seed = seed;
    this.field = new IntegratedWorldField(seed);
    this.group.name = 'life-lab-integrated-world';
    this.buildTerrain();
    this.buildWaterSurface();
    this.buildMigrationRoute();
    this.buildScatter();
  }

  /** Rebuild the small world deterministically from a new scenario seed. */
  setSeed(seed: number): void {
    this.clearResources();
    this.seed = seed;
    this.field = new IntegratedWorldField(seed);
    this.buildTerrain();
    this.buildWaterSurface();
    this.buildMigrationRoute();
    this.buildScatter();
  }

  update(timeSeconds: number): void {
    if (this.routePoints.length < 2 || this.landRoutePoints.length < 2) return;
    for (let index = 0; index < this.travelers.length; index++) {
      const phase = index * 0.8;
      const t = (timeSeconds * 0.012 + phase * 0.04) % 1;
      const isAirborne = index >= 4;
      const route = isAirborne ? this.routePoints : this.landRoutePoints;
      const scaled = t * route.length;
      const from = route[Math.floor(scaled) % route.length];
      const to = route[(Math.floor(scaled) + 1) % route.length];
      const blend = scaled - Math.floor(scaled);
      const x = from.x + (to.x - from.x) * blend;
      const z = from.z + (to.z - from.z) * blend;
      const altitude = isAirborne ? 10 : 2;
      const y = from.y + (to.y - from.y) * blend + altitude + Math.sin(timeSeconds * 4 + phase) * 0.35;
      this.travelers[index].position.set(x, y, z);
      this.travelers[index].rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
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
    const geometry = this.trackGeometry(new PlaneGeometry(220, 150));
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
          suitability: (sample: IScatterSurfaceSample) => sample.elevationM > 4 && sample.elevationM < 28 ? 1 : 0,
        }));
        meadow.push(...generateTerrainScatterInstances({
          ...base,
          identity: { ...base.identity, speciesId: 'meadow-tuft' },
          baseDensity01: this.biomeDensity(x, z, 'meadow'),
          suitability: (sample: IScatterSurfaceSample) => sample.elevationM > 0 && sample.elevationM < 16 ? 1 : 0,
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
            return sample.elevationM > -2 && clearOfRoute ? 1 : 0;
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
      const landX = Math.cos(angle + routePhase * 0.08) * 38;
      const landZ = Math.sin(angle) * 15 + Math.sin(angle * 2 + routePhase * 0.5) * 3;
      const landElevation = this.field.sample([landX, 0, landZ]).elevationM;
      this.landRoutePoints.push(new Vector3(landX, landElevation + 0.4, landZ));
    }
    const points = [...this.routePoints, this.routePoints[0]];
    const routeGeometry = new BufferGeometry().setFromPoints(points);
    this.geometries.push(routeGeometry);
    this.migration.add(new Line(routeGeometry, new LineBasicMaterial({ color: '#d5b85a', transparent: true, opacity: 0.45 })));
    const landPoints = [...this.landRoutePoints, this.landRoutePoints[0]];
    const landRouteGeometry = new BufferGeometry().setFromPoints(landPoints);
    this.geometries.push(landRouteGeometry);
    this.migration.add(new Line(landRouteGeometry, new LineBasicMaterial({ color: '#a96b45', transparent: true, opacity: 0.7 })));
    const travelerGeometry = this.trackGeometry(new ConeGeometry(0.7, 2.4, 4));
    const landMaterial = this.track(new MeshStandardMaterial({ color: '#a96b45', roughness: 0.8 }));
    const airMaterial = this.track(new MeshStandardMaterial({ color: '#f0d26a', roughness: 0.8 }));
    for (let index = 0; index < 8; index++) {
      const traveler = new Mesh(travelerGeometry, index < 4 ? landMaterial : airMaterial);
      this.travelers.push(traveler);
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
    this.migration.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
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
