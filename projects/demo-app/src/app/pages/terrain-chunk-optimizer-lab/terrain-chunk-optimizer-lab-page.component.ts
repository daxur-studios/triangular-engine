import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { simplifyIndexedGeometry } from 'triangular-engine/meshoptimizer';
import {
  generateTerrainPatchMesh,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchGeometry,
  type ITerrainPatchMesh,
  PlaneTerrainDomain,
  type TerrainVector3,
} from 'triangular-engine/terrain';

const PATCH_SIZE_M = 512;
const PATCH_RESOLUTION = 48;
const FEATURE_LOCK_THRESHOLD = 0.28;
const SAME_LEVEL_CHUNKS: readonly IPlaneTerrainPatchAddress[] = [
  { level: 0, x: -1, z: -1 },
  { level: 0, x: 0, z: -1 },
  { level: 0, x: -1, z: 0 },
  { level: 0, x: 0, z: 0 },
];
const MIXED_LEVEL_CHUNKS: readonly IPlaneTerrainPatchAddress[] = [
  { level: 0, x: -1, z: -1 },
  { level: 1, x: 0, z: -2 },
  { level: 1, x: 0, z: -1 },
  { level: 1, x: 1, z: -2 },
  { level: 1, x: 1, z: -1 },
];

type FlattenShape = 'circle' | 'rectangle';
interface IFlattenEdit {
  readonly enabled: boolean;
  readonly shape: FlattenShape;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusM: number;
  readonly widthM: number;
  readonly depthM: number;
  readonly targetElevationM: number;
  readonly blendM: number;
}

interface IChunkResult {
  readonly address: IPlaneTerrainPatchAddress;
  readonly patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>;
  readonly geometry: BufferGeometry;
  readonly resolution: number;
  readonly sourceTriangles: number;
  readonly triangles: number;
  readonly sourceVertices: number;
  readonly referencedVertices: number;
  readonly missingBoundaryVertices: number;
  readonly padErrorM: number;
}

/** One deterministic ridge and river crossing four independently simplified chunks. */
class ChunkFeatureField implements ITerrainField {
  readonly minElevationM = -80;
  readonly maxElevationM = 240;
  private flattening?: IFlattenEdit;

  setFlattening(flattening: IFlattenEdit | undefined): void {
    this.flattening = flattening;
  }

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.elevation(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < output.length; i += 1) {
      output[i] = this.elevation(positions[i * 3], positions[i * 3 + 2]);
    }
    return output;
  }

  featureWeights(x: number, z: number): { ridge: number; river: number } {
    const ridgeDistance = Math.abs(z - ridgeLineZ(x));
    const riverDistance = Math.abs(z - riverLineZ(x));
    return {
      ridge: gaussian(ridgeDistance, 34),
      river: gaussian(riverDistance, 21),
    };
  }

  private elevation(x: number, z: number): number {
    const features = this.featureWeights(x, z);
    const rollingBase =
      12 + Math.sin(x / 105) * 5 + Math.cos(z / 135) * 4;
    const baseElevation =
      rollingBase +
      features.ridge * 185 -
      features.river * 105 +
      Math.sin((x + z) / 38) * features.ridge * 7;
    const edit = this.flattening;
    if (!edit?.enabled) return baseElevation;
    const influence = flattenInfluence(x, z, edit);
    return baseElevation * (1 - influence) + edit.targetElevationM * influence;
  }
}

function flattenInfluence(x: number, z: number, edit: IFlattenEdit): number {
  const dx = x - edit.centerX;
  const dz = z - edit.centerZ;
  const outsideDistance =
    edit.shape === 'circle'
      ? Math.max(0, Math.hypot(dx, dz) - edit.radiusM)
      : Math.max(
          0,
          Math.max(Math.abs(dx) - edit.widthM / 2, Math.abs(dz) - edit.depthM / 2),
        );
  if (outsideDistance === 0) return 1;
  return 1 - smoothstep(0, edit.blendM, outsideDistance);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian(distance: number, width: number): number {
  return Math.exp(-(distance * distance) / (2 * width * width));
}

function ridgeLineZ(x: number): number {
  return 0.34 * x - 120;
}

function riverLineZ(x: number): number {
  return -0.28 * x - 165;
}

function asGeometry(
  patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  field: ChunkFeatureField,
  source: ITerrainPatchGeometry = patch.surface,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(source.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(source.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(source.uvs, 2));
  geometry.setAttribute(
    'color',
    new BufferAttribute(createFeatureColors(patch, field, source), 3),
  );
  geometry.setIndex(new BufferAttribute(source.indices, 1));
  return geometry;
}

function createFeatureColors(
  patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  field: ChunkFeatureField,
  source: ITerrainPatchGeometry = patch.surface,
): Float32Array {
  const colors = new Float32Array(source.positions.length);
  const meadow = new Color('#5d8f4d');
  const ridge = new Color('#927158');
  const snow = new Color('#d8d6c8');
  const river = new Color('#438fc4');
  const color = new Color();
  for (let offset = 0; offset < colors.length; offset += 3) {
    const x = patch.centerWorldM[0] + source.positions[offset];
    const z = patch.centerWorldM[2] + source.positions[offset + 2];
    const features = field.featureWeights(x, z);
    const elevation = patch.centerWorldM[1] + source.positions[offset + 1];
    if (features.river > 0.3) color.copy(river);
    else if (features.ridge > 0.3) {
      color.copy(ridge).lerp(snow, Math.max(0, (elevation - 150) / 80));
    } else color.copy(meadow);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  return colors;
}

@Component({
  selector: 'app-terrain-chunk-optimizer-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './terrain-chunk-optimizer-lab-page.component.html',
  styleUrl: './terrain-chunk-optimizer-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class TerrainChunkOptimizerLabPageComponent {
  readonly mixedResolution = signal(true);
  readonly maxReduction = signal(0.7);
  readonly lockBoundaries = signal(true);
  readonly protectFeatures = signal(true);
  readonly flattenEnabled = signal(false);
  readonly flattenShape = signal<FlattenShape>('circle');
  readonly wireframe = signal(false);
  readonly showGuides = signal(true);
  readonly sourceTriangleLabel = signal('—');
  readonly triangleLabel = signal('—');
  readonly reductionLabel = signal('—');
  readonly boundaryLabel = signal('—');
  readonly seamLabel = signal('—');
  readonly featureLabel = signal('—');
  readonly padLabel = signal('—');
  readonly buildLabel = signal('Building…');

  private readonly engine = inject(EngineService);
  private readonly field = new ChunkFeatureField();
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private readonly terrain = new Group();
  private revision = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.engine.scene.background = new Color('#08131c');
    this.engine.scene.add(this.terrain);
    void this.rebuild();
    destroyRef.onDestroy(() => {
      this.revision += 1;
      this.disposeTerrain();
      this.terrain.removeFromParent();
    });
  }

  setMaxReduction(event: Event): void {
    this.maxReduction.set(
      Math.max(0, Math.min(0.9, Number((event.target as HTMLInputElement).value))),
    );
    void this.rebuild();
  }

  toggleLayout(): void {
    this.mixedResolution.update((value) => !value);
    void this.rebuild();
  }

  toggleBoundaries(): void {
    this.lockBoundaries.update((value) => !value);
    void this.rebuild();
  }

  toggleFeatures(): void {
    this.protectFeatures.update((value) => !value);
    void this.rebuild();
  }

  toggleFlattening(): void {
    this.flattenEnabled.update((value) => !value);
    this.updateFlattening();
    void this.rebuild();
  }

  toggleFlattenShape(): void {
    this.flattenShape.update((value) => (value === 'circle' ? 'rectangle' : 'circle'));
    this.updateFlattening();
    void this.rebuild();
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
    this.terrain.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial)
        object.material.wireframe = this.wireframe();
    });
  }

  toggleGuides(): void {
    this.showGuides.update((value) => !value);
    this.terrain.children
      .filter((object) => object.name === 'feature-guide')
      .forEach((object) => (object.visible = this.showGuides()));
  }

  private async rebuild(): Promise<void> {
    const revision = ++this.revision;
    this.disposeTerrain();
    this.buildLabel.set('Building…');
    this.updateFlattening();
    const addresses = this.mixedResolution()
      ? MIXED_LEVEL_CHUNKS
      : SAME_LEVEL_CHUNKS;
    const reductions = [
      0,
      this.maxReduction() * 0.35,
      this.maxReduction() * 0.65,
      this.maxReduction(),
      this.maxReduction(),
    ];
    const results = await Promise.all(
      addresses.map((address, index) =>
        this.buildChunk(address, reductions[index]),
      ),
    );
    if (revision !== this.revision) {
      results.forEach((result) => result.geometry.dispose());
      return;
    }
    results.forEach((result) => this.installChunk(result));
    this.installFeatureGuides();
    const sourceTriangles = results.reduce((sum, result) => sum + result.sourceTriangles, 0);
    const triangles = results.reduce((sum, result) => sum + result.triangles, 0);
    const missingBoundaryVertices = results.reduce(
      (sum, result) => sum + result.missingBoundaryVertices,
      0,
    );
    const seam = this.measureMixedSeam(results);
    const padErrorM = Math.max(...results.map((result) => result.padErrorM));
    const sourceVertices = results.reduce((sum, result) => sum + result.sourceVertices, 0);
    const referencedVertices = results.reduce(
      (sum, result) => sum + result.referencedVertices,
      0,
    );
    this.sourceTriangleLabel.set(sourceTriangles.toLocaleString());
    this.triangleLabel.set(triangles.toLocaleString());
    this.reductionLabel.set(`${((1 - triangles / sourceTriangles) * 100).toFixed(1)}%`);
    this.boundaryLabel.set(
      this.lockBoundaries()
        ? missingBoundaryVertices === 0
          ? 'all boundary vertices retained'
          : `${missingBoundaryVertices} boundary vertices missing`
        : 'unlocked test mode',
    );
    this.seamLabel.set(
      this.mixedResolution()
        ? `${seam.missingSamples} edge samples missing; max height delta ${seam.maxHeightDeltaM.toFixed(3)}m`
        : 'same-level neighbours',
    );
    this.featureLabel.set(
      this.protectFeatures()
        ? 'ridge/river vertices locked'
        : 'feature locks off',
    );
    this.padLabel.set(
      this.flattenEnabled()
        ? `max pad error ${padErrorM.toFixed(2)}m; ${referencedVertices}/${sourceVertices} referenced vertices`
        : 'flattening off',
    );
    this.buildLabel.set('Ready');
  }

  private async buildChunk(
    address: IPlaneTerrainPatchAddress,
    reduction: number,
  ): Promise<IChunkResult> {
    // A level-zero edge bordering level-one children gets the child sample
    // spacing. The interior can still be simplified independently, while the
    // shared edge has one canonical vertex per fine sample and needs no skirt.
    const resolution =
      this.mixedResolution() && address.level === 0
        ? PATCH_RESOLUTION * 2
        : PATCH_RESOLUTION;
    const patch = generateTerrainPatchMesh(this.field, this.domain, {
      address,
      resolution,
    });
    const sourceGeometry = asGeometry(patch, this.field);
    const sourceTriangles = sourceGeometry.index!.count / 3;
    const sourceVertices = sourceGeometry.getAttribute('position').count;
    const lockedVertices = this.protectFeatures()
      ? this.createFeatureLocks(patch)
      : undefined;
    const result = await simplifyIndexedGeometry(sourceGeometry, {
      ratio: reduction,
      targetError: 0.08,
      flags: this.lockBoundaries() ? ['LockBorder'] : [],
      lockedVertices,
    });
    sourceGeometry.dispose();
    result.geometry.computeVertexNormals();
    const missingBoundaryVertices = this.countMissingBoundaryVertices(
      result.geometry,
      resolution,
    );
    const referencedVertices = this.countReferencedVertices(result.geometry);
    return {
      address,
      patch,
      geometry: result.geometry,
      resolution,
      sourceTriangles,
      triangles: result.indexCount / 3,
      sourceVertices,
      referencedVertices,
      missingBoundaryVertices,
      padErrorM: this.measurePadError(result.geometry, patch),
    };
  }

  private createFeatureLocks(
    patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  ): Uint8Array {
    const positions = patch.surface.positions;
    const locks = new Uint8Array(positions.length / 3);
    for (let vertex = 0; vertex < locks.length; vertex += 1) {
      const offset = vertex * 3;
      const x = patch.centerWorldM[0] + positions[offset];
      const z = patch.centerWorldM[2] + positions[offset + 2];
      const features = this.field.featureWeights(x, z);
      if (Math.max(features.ridge, features.river) >= FEATURE_LOCK_THRESHOLD)
        locks[vertex] = 1;
    }
    return locks;
  }

  private updateFlattening(): void {
    this.field.setFlattening({
      enabled: this.flattenEnabled(),
      shape: this.flattenShape(),
      centerX: 128,
      centerZ: 256,
      radiusM: 78,
      widthM: 170,
      depthM: 112,
      targetElevationM: 35,
      blendM: 64,
    });
  }

  private countMissingBoundaryVertices(
    geometry: BufferGeometry,
    resolution: number,
  ): number {
    const row = resolution + 1;
    const boundary = new Set<number>();
    for (let index = 0; index <= resolution; index += 1) {
      boundary.add(index);
      boundary.add(resolution * row + index);
      boundary.add(index * row);
      boundary.add(index * row + resolution);
    }
    const referenced = new Set<number>();
    const index = geometry.index;
    if (index) for (const value of index.array) referenced.add(Number(value));
    return [...boundary].filter((vertex) => !referenced.has(vertex)).length;
  }

  private countReferencedVertices(geometry: BufferGeometry): number {
    const referenced = new Set<number>();
    const index = geometry.index;
    if (index) for (const value of index.array) referenced.add(Number(value));
    return referenced.size;
  }

  private measureMixedSeam(results: readonly IChunkResult[]): {
    missingSamples: number;
    maxHeightDeltaM: number;
  } {
    if (!this.mixedResolution()) return { missingSamples: 0, maxHeightDeltaM: 0 };
    const coarse = results.find(
      (result) => result.address.level === 0 && result.address.x === -1,
    );
    if (!coarse) return { missingSamples: 0, maxHeightDeltaM: 0 };
    const coarseEdge = this.referencedWorldVertices(coarse, 'right');
    let missingSamples = 0;
    let maxHeightDeltaM = 0;
    results
      .filter((result) => result.address.level === 1 && result.address.x === 0)
      .forEach((child) => {
        const childEdge = this.referencedWorldVertices(child, 'left');
        childEdge.forEach((childVertex, key) => {
          const coarseVertex = coarseEdge.get(key);
          if (!coarseVertex) {
            missingSamples += 1;
            return;
          }
          maxHeightDeltaM = Math.max(
            maxHeightDeltaM,
            Math.abs(coarseVertex[1] - childVertex[1]),
          );
        });
      });
    return { missingSamples, maxHeightDeltaM };
  }

  private referencedWorldVertices(
    result: IChunkResult,
    edge: 'left' | 'right',
  ): Map<string, TerrainVector3> {
    const positions = result.geometry.getAttribute('position');
    const referenced = new Set<number>();
    const index = result.geometry.index;
    if (index) for (const value of index.array) referenced.add(Number(value));
    const bounds = this.domain.getPatchBounds(result.address);
    const edgeU = edge === 'left' ? bounds.minU : bounds.maxU;
    const vertices = new Map<string, TerrainVector3>();
    referenced.forEach((vertex) => {
      const x = result.patch.centerWorldM[0] + positions.getX(vertex);
      const y = result.patch.centerWorldM[1] + positions.getY(vertex);
      const z = result.patch.centerWorldM[2] + positions.getZ(vertex);
      if (Math.abs(x - edgeU) < 0.01) {
        vertices.set(worldKey(x, z), [x, y, z]);
      }
    });
    return vertices;
  }

  private measurePadError(
    geometry: BufferGeometry,
    patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  ): number {
    if (!this.flattenEnabled()) return 0;
    const edit: IFlattenEdit = {
      enabled: true,
      shape: this.flattenShape(),
      centerX: 128,
      centerZ: 256,
      radiusM: 78,
      widthM: 170,
      depthM: 112,
      targetElevationM: 35,
      blendM: 64,
    };
    const positions = geometry.getAttribute('position');
    const referenced = new Set<number>();
    const index = geometry.index;
    if (index) for (const value of index.array) referenced.add(Number(value));
    let maximum = 0;
    referenced.forEach((vertex) => {
      const x = patch.centerWorldM[0] + positions.getX(vertex);
      const z = patch.centerWorldM[2] + positions.getZ(vertex);
      const dx = x - edit.centerX;
      const dz = z - edit.centerZ;
      const inside =
        edit.shape === 'circle'
          ? Math.hypot(dx, dz) <= edit.radiusM
          : Math.abs(dx) <= edit.widthM / 2 && Math.abs(dz) <= edit.depthM / 2;
      if (inside) {
        maximum = Math.max(
          maximum,
          Math.abs(patch.centerWorldM[1] + positions.getY(vertex) - edit.targetElevationM),
        );
      }
    });
    return maximum;
  }

  private installChunk(result: IChunkResult): void {
    const material = new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.9,
      wireframe: this.wireframe(),
    });
    const mesh = new Mesh(result.geometry, material);
    mesh.position.set(...result.patch.centerWorldM);
    this.terrain.add(mesh);

    const border = this.createBorder(result.patch);
    border.position.set(...result.patch.centerWorldM);
    this.terrain.add(border);
  }

  private createBorder(
    patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>,
  ): LineLoop {
    const bounds = this.domain.getPatchBounds(patch.address);
    const centerX = patch.centerWorldM[0];
    const centerY = patch.centerWorldM[1];
    const centerZ = patch.centerWorldM[2];
    const points = [
      this.borderPoint(bounds.minU, bounds.minV, centerX, centerY, centerZ),
      this.borderPoint(bounds.maxU, bounds.minV, centerX, centerY, centerZ),
      this.borderPoint(bounds.maxU, bounds.maxV, centerX, centerY, centerZ),
      this.borderPoint(bounds.minU, bounds.maxV, centerX, centerY, centerZ),
    ];
    const geometry = new BufferGeometry().setFromPoints(points);
    return new LineLoop(
      geometry,
      new LineBasicMaterial({ color: '#d7f08a', depthTest: false }),
    );
  }

  private borderPoint(
    u: number,
    v: number,
    centerX: number,
    centerY: number,
    centerZ: number,
  ): Vector3 {
    const x = u;
    const z = -v;
    return new Vector3(
      x - centerX,
      this.field.sample([x, 0, z]).elevationM - centerY + 2,
      z - centerZ,
    );
  }

  private installFeatureGuides(): void {
    const material = new LineBasicMaterial({ color: '#f0c36a', depthTest: false });
    const riverMaterial = new LineBasicMaterial({ color: '#70c9ff', depthTest: false });
    this.installGuide('ridge', material, ridgeLineZ);
    this.installGuide('river', riverMaterial, riverLineZ);
  }

  private installGuide(
    name: string,
    material: LineBasicMaterial,
    line: (x: number) => number,
  ): void {
    const points: Vector3[] = [];
    for (let x = -512; x <= 512; x += 16) {
      const z = line(x);
      points.push(new Vector3(x, this.field.sample([x, 0, z]).elevationM + 8, z));
    }
    const guide = new Line(new BufferGeometry().setFromPoints(points), material);
    guide.name = 'feature-guide';
    guide.visible = this.showGuides();
    this.terrain.add(guide);
  }

  private disposeTerrain(): void {
    this.terrain.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
    while (this.terrain.children.length) this.terrain.remove(this.terrain.children[0]);
  }
}

function worldKey(x: number, z: number): string {
  return `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
}
