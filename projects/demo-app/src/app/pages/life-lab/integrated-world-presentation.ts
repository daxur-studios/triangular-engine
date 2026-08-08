import {
  BufferGeometry,
  BufferAttribute,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
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
  private readonly field: ITerrainField = new IntegratedWorldField();
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly migration = new Group();
  private readonly travelers: Mesh[] = [];

  constructor() {
    this.group.name = 'life-lab-integrated-world';
    this.buildTerrain();
    this.buildScatter();
    this.buildMigrationRoute();
  }

  update(timeSeconds: number): void {
    for (let index = 0; index < this.travelers.length; index++) {
      const phase = index * 0.8;
      const t = (timeSeconds * 0.018 + phase * 0.04) % 1;
      const x = -82 + t * 164 + Math.sin(timeSeconds * 0.22 + phase) * 8;
      const z = -18 + Math.sin(t * Math.PI * 2) * 26 + Math.cos(timeSeconds * 0.11 + phase) * 4;
      // Keep the route and the terrain in the same coordinate space. The small
      // lift prevents the marker from intersecting the surface as it moves.
      const y = this.field.sample([x, 0, z]).elevationM + 2 + Math.sin(timeSeconds * 4 + phase) * 0.5;
      this.travelers[index].position.set(x, y, z);
      this.travelers[index].rotation.y = Math.atan2(Math.cos(t * Math.PI * 2), 1);
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
          identity: { worldSeed: 909, layerId: 'integrated-life', speciesId: 'forest-meadow', generatorVersion: 1 },
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
  }

  private buildMigrationRoute(): void {
    const points: Vector3[] = [];
    for (let index = 0; index <= 32; index++) {
      const t = index / 32;
      const x = -82 + t * 164;
      const z = -18 + Math.sin(t * Math.PI * 2) * 26;
      points.push(new Vector3(x, this.field.sample([x, 0, z]).elevationM + 0.4, z));
    }
    const routeGeometry = new BufferGeometry().setFromPoints(points);
    this.geometries.push(routeGeometry);
    this.migration.add(new Line(routeGeometry, new LineBasicMaterial({ color: '#d5b85a', transparent: true, opacity: 0.65 })));
    const travelerGeometry = this.trackGeometry(new ConeGeometry(0.7, 2.4, 4));
    const travelerMaterial = this.track(new MeshStandardMaterial({ color: '#d98b4a', roughness: 0.8 }));
    for (let index = 0; index < 8; index++) {
      const traveler = new Mesh(travelerGeometry, travelerMaterial);
      this.travelers.push(traveler);
      this.migration.add(traveler);
    }
    this.group.add(this.migration);
  }

  private biomeDensity(cellX: number, cellZ: number, biome: 'forest' | 'meadow'): number {
    const ridge = Math.sin(cellX * 0.9 + cellZ * 0.35) * 0.5 + 0.5;
    if (biome === 'forest') return Math.max(0, Math.min(1, ridge * 1.4 - Math.abs(cellZ) * 0.12));
    return Math.max(0, Math.min(1, 1 - ridge * 0.75 + Math.abs(cellZ) * 0.08));
  }

  private attribute(values: Float32Array, itemSize: number): BufferAttribute {
    return new Float32BufferAttribute(values, itemSize);
  }

  private track<T extends MeshStandardMaterial>(material: T): T { this.materials.push(material); return material; }
  private trackGeometry<T extends BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry; }
}

class IntegratedWorldField implements ITerrainField {
  readonly minElevationM = -8;
  readonly maxElevationM = 46;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const meadow = Math.sin(x / 21) * 3 + Math.cos(z / 28) * 4;
    const ridge = Math.exp(-Math.pow((x + 42) / 32, 2)) * 28;
    const mountain = Math.exp(-Math.pow((x - 55) / 38, 2) - Math.pow((z + 8) / 55, 2)) * 34;
    const crater = -Math.exp(-Math.pow((x - 8) / 27, 2) - Math.pow((z - 24) / 24, 2)) * 12;
    return { elevationM: meadow + ridge + mountain + crater };
  }

  sampleBatch(positions: Float64Array, out = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.sample([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]).elevationM;
    return out;
  }
}
