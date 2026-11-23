import {
  DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D,
  type WebGLRenderer,
} from 'three';
import {
  buildOctahedralImpostorInstancedMesh, createOctahedralImpostorAtlas, type IOctahedralImpostorAtlas,
} from 'triangular-engine/impostor';
import { buildCrowdWalkPoses, WALK_FRAMES } from './capsule-crowd-poses';

const VIEWS_PER_SIDE = 5;
const ATLAS_SIZE = 320;

export type CrowdViewMode = 'mesh' | 'impostor';

/** Two renderers for one pose stream. Each draws at most one batch per occupied walk frame. */
export class CapsuleCrowdView {
  readonly root = new Group();
  private readonly poses = buildCrowdWalkPoses();
  private readonly meshMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .87 });
  private readonly bakeTarget = new Group();
  private readonly bakeMeshes = this.poses.map(geometry => new Mesh(geometry, this.meshMaterial));
  private readonly meshBatches: InstancedMesh[];
  private readonly impostorBatches: InstancedMesh[] = [];
  private readonly atlases: IOctahedralImpostorAtlas[] = [];
  private readonly transform = new Object3D();
  private readonly counts = new Uint16Array(WALK_FRAMES);

  constructor(private readonly capacity: number) {
    this.bakeTarget.add(...this.bakeMeshes);
    this.bakeTarget.updateMatrixWorld(true);
    this.meshBatches = this.poses.map(geometry => this.configure(new InstancedMesh(geometry, this.meshMaterial, capacity)));
  }

  get bakedFrames(): number {
    return this.atlases.length;
  }

  bakeNextFrame(renderer: WebGLRenderer): void {
    const frame = this.bakedFrames;
    if (frame >= WALK_FRAMES) return;

    // The baker includes hidden meshes in its bounds. Keep all poses in the same
    // hierarchy so centre and scale stay fixed across the whole animation.
    this.bakeMeshes.forEach((mesh, index) => mesh.visible = index === frame);
    const atlas = createOctahedralImpostorAtlas({
      renderer, target: this.bakeTarget, textureSize: ATLAS_SIZE, spritesPerSide: VIEWS_PER_SIDE,
    });
    this.atlases.push(atlas);
    const { instancedMesh } = buildOctahedralImpostorInstancedMesh({
      target: this.bakeTarget, baseType: MeshStandardMaterial,
      albedo: atlas.albedo, normalDepth: atlas.normalDepth, spritesPerSide: VIEWS_PER_SIDE,
    }, this.capacity);
    instancedMesh.material.roughness = this.meshMaterial.roughness;
    this.impostorBatches.push(this.configure(instancedMesh));
  }

  update(mode: CrowdViewMode, x: Float32Array, z: Float32Array, yaw: Float32Array, phase: Float32Array) {
    const batches = mode === 'impostor' ? this.impostorBatches : this.meshBatches;
    this.counts.fill(0);
    for (let i = 0; i < x.length; i++) {
      const frame = Math.floor(phase[i] * WALK_FRAMES) % WALK_FRAMES;
      this.transform.position.set(x[i], 0, z[i]);
      this.transform.rotation.y = yaw[i];
      this.transform.updateMatrix();
      batches[frame].setMatrixAt(this.counts[frame]++, this.transform.matrix);
    }

    let draws = 0;
    let triangles = 0;
    batches.forEach((batch, frame) => {
      batch.count = this.counts[frame];
      batch.instanceMatrix.needsUpdate = batch.count > 0;
      batch.visible = batch.count > 0;
      if (batch.visible) {
        draws++;
        triangles += batch.count * (batch.geometry.index!.count / 3);
      }
    });
    const hidden = mode === 'impostor' ? this.meshBatches : this.impostorBatches;
    for (const batch of hidden) batch.visible = false;
    return { draws, triangles };
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const batch of this.meshBatches) batch.dispose();
    for (const batch of this.impostorBatches) {
      batch.dispose();
      batch.geometry.dispose();
      (batch.material as MeshStandardMaterial).dispose();
    }
    for (const atlas of this.atlases) atlas.renderTarget.dispose();
    for (const geometry of this.poses) geometry.dispose();
    this.meshMaterial.dispose();
  }

  private configure(batch: InstancedMesh): InstancedMesh {
    batch.instanceMatrix.setUsage(DynamicDrawUsage);
    // Each frame contains agents distributed across the whole plaza.
    batch.frustumCulled = false;
    batch.count = 0;
    batch.visible = false;
    this.root.add(batch);
    return batch;
  }
}
