import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  generateScatterCandidates,
  type IScatterCellIdentity,
} from 'triangular-engine/scatter';
import {
  planLifeRoute,
  sampleLifeRouteAtTime,
  type LifeHabitatQuery,
  type LifeDeterministicRoute,
} from 'triangular-engine/life';
import {
  PlaneTerrainDomain,
  TerrainSurfaceComponent,
  type IPlaneTerrainPatchAddress,
  type ITerrainSurfaceColorContext,
} from 'triangular-engine/terrain';
import type { ITerrainField, TerrainVector3 } from 'triangular-engine/terrain';

type Biome = 'ice' | 'meadow' | 'jungle' | 'desert' | 'water';
type TimeScale = 1 | 10 | 100 | 1000;

interface SpeciesEntry {
  readonly id: string;
  readonly label: string;
  readonly habitat: string;
  readonly route: string;
  readonly lod: string;
}

const WORLD_WIDTH = 360;
const WORLD_DEPTH = 240;
const CELL_SIZE = 20;
const GRID_X = WORLD_WIDTH / CELL_SIZE;
const GRID_Z = WORLD_DEPTH / CELL_SIZE;

const SPECIES: readonly SpeciesEntry[] = [
  { id: 'meadow-herd', label: 'Meadow herd', habitat: 'Meadow / tundra', route: 'Local region', lod: 'Near' },
  { id: 'migratory-bird', label: 'Migratory birds', habitat: 'Air over all biomes', route: 'Meadow ↔ jungle ↔ desert', lod: 'Far' },
  { id: 'jungle-insect', label: 'Jungle insects', habitat: 'Jungle / vegetation', route: 'Local swarm', lod: 'Very near' },
  { id: 'lake-fish', label: 'Lake fish', habitat: 'Lakes / ocean', route: 'Water regions', lod: 'Medium' },
];

class LargeWorldField implements ITerrainField {
  readonly minElevationM = -1;
  readonly maxElevationM = 28;

  constructor(private readonly seed: number) {}

  sample(position: TerrainVector3): { elevationM: number } {
    return { elevationM: this.heightAt(position[0], position[2]) };
  }

  sampleBatch(fieldPositions: Float64Array, elevationsM?: Float64Array): Float64Array {
    const output = elevationsM ?? new Float64Array(fieldPositions.length / 3);
    for (let index = 0; index < output.length; index++) {
      output[index] = this.heightAt(fieldPositions[index * 3], fieldPositions[index * 3 + 2]);
    }
    return output;
  }

  biomeAt(x: number, z: number): Biome {
    if (this.isWater(x, z)) return 'water';
    const latitude = Math.abs(z);
    if (latitude > 96) return 'ice';
    if (latitude > 56) return 'meadow';
    if (x < -48) return 'desert';
    if (x > 48) return 'jungle';
    return 'meadow';
  }

  isWater(x: number, z: number): boolean {
    const westOcean = x < -148;
    const lakeA = ((x + 8) / 30) ** 2 + ((z - 2) / 22) ** 2 < 1;
    const lakeB = ((x - 78) / 36) ** 2 + ((z + 15) / 18) ** 2 < 1;
    return westOcean || lakeA || lakeB;
  }

  heightAt(x: number, z: number): number {
    if (this.isWater(x, z)) return 0.05;
    const hills = Math.sin((x + this.seed) * 0.045) * 2.8 + Math.cos((z - this.seed) * 0.06) * 2.1;
    const mountainRidge = Math.max(0, 1 - Math.abs(x - 18) / 22) * (8 + 8 * (0.5 + 0.5 * Math.sin(z * 0.075 + this.seed)));
    return Math.max(0.25, 3.2 + hills + mountainRidge);
  }
}

@Component({
  selector: 'app-large-world-life-poc-page',
  imports: [RouterLink, EngineModule, TerrainSurfaceComponent],
  templateUrl: './large-world-life-poc-page.component.html',
  styleUrl: './large-world-life-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class LargeWorldLifePocPageComponent {
  protected seed = 4201;
  protected universalTimeSeconds = 0;
  protected timeScale: TimeScale = 1;
  protected routesVisible = true;
  protected catalogueVisible = true;
  protected readonly timeScales: readonly TimeScale[] = [1, 10, 100, 1000];
  protected readonly species = SPECIES;

  private readonly engine = inject(EngineService);
  private readonly world = new Group();
  private readonly terrainGroup = new Group();
  private readonly waterGroup = new Group();
  private readonly scatterGroup = new Group();
  private readonly routeGroup = new Group();
  private readonly markers = new Group();
  protected worldField = new LargeWorldField(this.seed);
  protected readonly terrainDomain = new PlaneTerrainDomain(180);
  protected readonly terrainRoots: readonly IPlaneTerrainPatchAddress[] = [
    { level: 0, x: -1, z: -1 },
    { level: 0, x: 0, z: -1 },
    { level: 0, x: -1, z: 0 },
    { level: 0, x: 0, z: 0 },
  ];
  protected readonly createTerrainColors = (
    context: ITerrainSurfaceColorContext<IPlaneTerrainPatchAddress>,
  ): Float32Array => {
    const colors = new Float32Array(context.surface.positions.length);
    const color = new Color();
    for (let index = 0; index < context.surface.positions.length / 3; index++) {
      const offset = index * 3;
      const x = context.surface.positions[offset] + context.centerWorldM[0];
      const z = context.surface.positions[offset + 2] + context.centerWorldM[2];
      color.set(this.biomeColour(this.worldField.biomeAt(x, z)));
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  };
  protected readonly createTerrainMaterial = () =>
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: false,
    });
  private readonly routeMarkers: readonly Mesh[];
  private routes: readonly (LifeDeterministicRoute | null)[] = [];
  private readonly routeLines: Line[] = [];
  private readonly markerObjects = [
    new Object3D(),
    new Object3D(),
    new Object3D(),
  ];
  private readonly markerMeshes: readonly Mesh[];

  constructor() {
    this.world.name = 'large-world-life-poc';
    this.world.add(this.terrainGroup, this.waterGroup, this.scatterGroup, this.routeGroup, this.markers);
    this.buildScene();
    this.routeMarkers = this.markerObjects.map((_, index) => {
      const mesh = new Mesh(
        new SphereGeometry(index === 1 ? 1.2 : 1, 8, 6),
        new MeshStandardMaterial({ color: index === 0 ? '#f4c26b' : index === 1 ? '#d9f1ff' : '#d88452' }),
      );
      this.markers.add(mesh);
      return mesh;
    });
    this.markerMeshes = this.routeMarkers;
    this.rebuildRoutes();
    this.engine.scene.add(this.world);

    const destroyRef = inject(DestroyRef);
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    destroyRef.onDestroy(() => this.dispose());
  }

  protected randomize(): void {
    this.seed = Math.floor(Math.random() * 900_000) + 1;
    this.rebuildWorld();
  }

  protected setTimeScale(scale: TimeScale): void {
    this.timeScale = scale;
  }

  protected toggleRoutes(): void {
    this.routesVisible = !this.routesVisible;
    this.routeGroup.visible = this.routesVisible;
    this.markers.visible = this.routesVisible;
  }

  protected toggleCatalogue(): void {
    this.catalogueVisible = !this.catalogueVisible;
  }

  protected scrub(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) this.universalTimeSeconds = parsed;
  }

  private buildScene(): void {
    this.buildWater();
    this.buildScatter();
  }

  private rebuildWorld(): void {
    this.worldField = new LargeWorldField(this.seed);
    this.clearGroup(this.terrainGroup);
    this.clearGroup(this.waterGroup);
    this.clearGroup(this.scatterGroup);
    this.clearGroup(this.routeGroup);
    this.buildScene();
    this.rebuildRoutes();
  }

  private buildWater(): void {
    const waterMaterial = new MeshBasicMaterial({ color: '#4e9ec2', transparent: true, opacity: 0.78 });
    for (let zIndex = 0; zIndex < GRID_Z; zIndex++) {
      for (let xIndex = 0; xIndex < GRID_X; xIndex++) {
        const x = -WORLD_WIDTH / 2 + (xIndex + 0.5) * CELL_SIZE;
        const z = -WORLD_DEPTH / 2 + (zIndex + 0.5) * CELL_SIZE;
        if (!this.worldField.isWater(x, z)) continue;
        const water = new Mesh(new PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96), waterMaterial);
        water.rotation.x = -Math.PI / 2;
        water.position.set(x, 0.45, z);
        this.waterGroup.add(water);
      }
    }
  }

  private buildScatter(): void {
    const treePositions: Vector3[] = [];
    const rockPositions: Vector3[] = [];
    const icePositions: Vector3[] = [];
    for (let zIndex = 0; zIndex < GRID_Z; zIndex++) {
      for (let xIndex = 0; xIndex < GRID_X; xIndex++) {
        const x = -WORLD_WIDTH / 2 + xIndex * CELL_SIZE;
        const z = -WORLD_DEPTH / 2 + zIndex * CELL_SIZE;
        const biome = this.worldField.biomeAt(x + CELL_SIZE / 2, z + CELL_SIZE / 2);
        const identity: IScatterCellIdentity = {
          worldSeed: this.seed,
          layerId: 'large-world-scatter',
          speciesId: biome,
          generatorVersion: 1,
          cellKey: `${xIndex}:${zIndex}`,
        };
        for (const candidate of generateScatterCandidates(identity, 6)) {
          if (candidate.densitySeed01 > (biome === 'jungle' ? 0.42 : 0.72)) continue;
          const px = x + candidate.localU * CELL_SIZE;
          const pz = z + candidate.localV * CELL_SIZE;
          if (this.worldField.isWater(px, pz)) continue;
          const position = new Vector3(px, this.worldField.heightAt(px, pz), pz);
          if (biome === 'jungle' || biome === 'meadow') treePositions.push(position);
          else if (biome === 'ice') icePositions.push(position);
          else if (biome === 'desert') rockPositions.push(position);
        }
      }
    }
    this.addInstances(treePositions, new ConeGeometry(1.1, 5, 6), '#2d693c', 1.5);
    this.addInstances(rockPositions, new SphereGeometry(1.5, 6, 4), '#a97952', 1.3);
    this.addInstances(icePositions, new ConeGeometry(1.5, 4, 5), '#d9f1ff', 1.2);
  }

  private addInstances(positions: readonly Vector3[], geometry: BufferGeometry, colour: string, scale: number): void {
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ color: colour, roughness: 1 }), positions.length);
    const object = new Object3D();
    positions.forEach((position, index) => {
      object.position.copy(position);
      object.scale.setScalar(scale);
      object.rotation.y = (index * 2.399) % Math.PI;
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scatterGroup.add(mesh);
  }

  private rebuildRoutes(): void {
    this.routeLines.splice(0).forEach((line) => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    });
    this.clearGroup(this.routeGroup);
    const habitat: LifeHabitatQuery = {
      sampleHabitat: ({ x, z }) => {
        const biome = this.worldField.biomeAt(x, z);
        const height = this.worldField.heightAt(x, z);
        // Treat the whole mountain shoulder as an obstacle, not only its peak.
        // This gives the planner enough clearance to route around the ridge.
        return { kind: biome === 'water' ? 'water' : height > 9 ? 'obstacle' : 'land', surfaceY: height, suitability01: 1 };
      },
    };
    const routes = [
      planLifeRoute({ query: habitat, start: { x: -125, y: 4, z: 70 }, goal: { x: 110, y: 4, z: 70 }, allowedKinds: ['land'], cellSize: 10, maxSearchNodes: 12_000, travelSpeed: 4, universalTimeSeconds: 0 }),
      // Air route is intentionally elevated above the highest ridge in this
      // compact POC; terrain obstacles constrain ground routes, not flight.
      planLifeRoute({ query: habitat, start: { x: -100, y: 30, z: 0 }, goal: { x: 105, y: 30, z: 0 }, allowedKinds: ['land', 'water'], cellSize: 10, maxSearchNodes: 12_000, travelSpeed: 9, universalTimeSeconds: 0 }),
      planLifeRoute({ query: habitat, start: { x: 55, y: 1, z: -15 }, goal: { x: 105, y: 1, z: -15 }, allowedKinds: ['water'], cellSize: 5, maxSearchNodes: 4_000, travelSpeed: 2, universalTimeSeconds: 0 }),
    ];
    // A failed plan remains absent. The POC must expose planner limitations,
    // never replace them with a page-authored route that would not exist in
    // the reusable runtime.
    this.routes = routes.map((route) => route ? { closed: false, segments: route } : null);
    this.routes.forEach((route, index) => {
      if (!route) return;
      const positions: number[] = [];
      route.segments.forEach((segment, segmentIndex) => {
        if (segmentIndex === 0) positions.push(segment.from.x, segment.from.y + 0.6, segment.from.z);
        positions.push(segment.to.x, segment.to.y + 0.6, segment.to.z);
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      const line = new Line(geometry, new LineBasicMaterial({ color: ['#f4c26b', '#d9f1ff', '#ef9a69'][index], linewidth: 2 }));
      this.routeGroup.add(line);
      this.routeLines.push(line);
    });
  }

  private update(deltaSeconds: number): void {
    this.universalTimeSeconds += deltaSeconds * this.timeScale;
    this.routes.forEach((route, index) => {
      if (!route) {
        this.markerMeshes[index].visible = false;
        return;
      }
      this.markerMeshes[index].visible = this.routesVisible;
      const sample = sampleLifeRouteAtTime(route, this.universalTimeSeconds + index * 40);
      this.markerMeshes[index].position.set(sample.position.x, sample.position.y + 1, sample.position.z);
    });
  }

  private biomeColour(biome: Biome): string {
    return { ice: '#dcecf2', meadow: '#6e9b62', jungle: '#286442', desert: '#bd8d57', water: '#4e9ec2' }[biome];
  }

  private clearGroup(group: Group): void {
    while (group.children.length > 0) {
      const child = group.children.pop();
      if (!child) continue;
      child.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as MeshStandardMaterial | MeshBasicMaterial | LineBasicMaterial;
        if (material?.dispose) material.dispose();
      });
    }
  }

  private dispose(): void {
    this.world.removeFromParent();
    this.clearGroup(this.world);
    this.markerMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    });
  }
}
