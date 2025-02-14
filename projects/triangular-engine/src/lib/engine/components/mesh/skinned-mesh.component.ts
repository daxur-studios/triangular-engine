import { Component, effect, input, signal } from '@angular/core';
import {
  SkinnedMesh,
  Skeleton,
  Material,
  BufferGeometry,
  Mesh,
  SkeletonHelper,
  BoxGeometry,
  MeshStandardMaterial,
  Bone,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
  CylinderGeometry,
} from 'three';
import { MeshComponent } from './mesh.component';
import { provideObject3DComponent } from '../object-3d/object-3d.component';

@Component({
  standalone: true,
  selector: 'skinnedMesh',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(SkinnedMeshComponent)],
})
export class SkinnedMeshComponent extends MeshComponent {
  override readonly mesh = signal<SkinnedMesh>(new SkinnedMesh());
  override object3D = this.mesh;

  readonly skeleton = input<Skeleton>();
  readonly morphTargetDictionary = input<{ [key: string]: number }>();
  readonly morphTargetInfluences = input<number[]>();

  readonly debug = input<boolean>();
  #skeletonHelper: SkeletonHelper | undefined;
  #bones: Bone[] = [];

  constructor() {
    super();
    this.#initializeMesh();
  }

  #initializeMesh() {
    const geometry = new CylinderGeometry(5, 5, 5, 5, 15, true);
    const material = new MeshStandardMaterial({
      color: 0x00ff00,
      wireframe: true,
    });

    const mesh = new SkinnedMesh(geometry, material);
    this.mesh.set(mesh);

    // Create bones
    const height = 5;
    const boneCount = 5;
    const segmentHeight = height / (boneCount - 1);

    for (let i = 0; i < boneCount; i++) {
      const bone = new Bone();
      bone.position.y = i * segmentHeight - height / 2;
      this.#bones.push(bone);

      if (i > 0) {
        this.#bones[i - 1].add(bone);
      }
    }

    // Create skeleton and bind it
    const skeleton = new Skeleton(this.#bones);
    mesh.add(this.#bones[0]);
    mesh.bind(skeleton);

    // Set up skinning
    const position = geometry.attributes['position'];
    const skinIndices = [];
    const skinWeights = [];
    const vertex = new Vector3();

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      const y = (vertex.y + height / 2) / height;
      const skinIndex = Math.floor(y * (boneCount - 1));
      const skinWeight = (y % (1 / (boneCount - 1))) * (boneCount - 1);

      skinIndices.push(skinIndex, Math.min(skinIndex + 1, boneCount - 1), 0, 0);
      skinWeights.push(1 - skinWeight, skinWeight, 0, 0);
    }

    geometry.setAttribute(
      'skinIndex',
      new Uint16BufferAttribute(skinIndices, 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(skinWeights, 4),
    );

    // Ensure matrices are updated
    skeleton.pose();
    mesh.updateMatrixWorld(true);

    this.#initDebug();
    this.#initSkeleton();
    this.#initMorphTargets();
  }

  #initDebug() {
    effect(() => {
      const debug = this.debug();
      const mesh = this.mesh();

      if (debug && mesh) {
        if (!this.#skeletonHelper) {
          this.#skeletonHelper = new SkeletonHelper(mesh);
          this.engineService.scene.add(this.#skeletonHelper);
        }
      }

      if (!debug && this.#skeletonHelper) {
        this.engineService.scene.remove(this.#skeletonHelper);
        this.#skeletonHelper = undefined;
      }
    });
  }

  #initSkeleton() {
    effect(() => {
      const skinnedMesh = this.mesh();
      const skeleton = this.skeleton();

      if (skeleton && skinnedMesh.geometry) {
        skinnedMesh.skeleton = skeleton;
        skinnedMesh.bind(skeleton);
      }
    });
  }

  #initMorphTargets() {
    effect(() => {
      const skinnedMesh = this.mesh();
      const dictionary = this.morphTargetDictionary();
      const influences = this.morphTargetInfluences();

      if (dictionary) {
        skinnedMesh.morphTargetDictionary = dictionary;
      }

      if (influences) {
        skinnedMesh.morphTargetInfluences = influences;
      }
    });
  }
}
