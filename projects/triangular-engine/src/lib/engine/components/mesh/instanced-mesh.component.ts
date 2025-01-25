import {
  Component,
  WritableSignal,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import {
  InstancedMesh,
  Material,
  BufferGeometry,
  Object3D,
  Matrix4,
  Vector3,
  Euler,
} from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { xyz } from '../../models';

// Geometry Change: Update instancedMesh.geometry and dispose of the old geometry.
// Material Change: Update instancedMesh.material and dispose of the old material.
// Position Change: Update instance matrices; no need to recreate.
// Count Increase: Dispose and recreate InstancedMesh with a higher count.
// Count Decrease: Adjust instancedMesh.count; no need to recreate.

export interface IInstancedMeshData {
  position: xyz;
  rotation: xyz;
  scale: xyz;
}

@Component({
  standalone: true,
  selector: 'instancedMesh',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(InstancedMeshComponent)],
})
export class InstancedMeshComponent extends Object3DComponent {
  override emoji = '🧩';

  /** The maximum number of instances*/
  readonly maxCount = input.required<number>();
  #prevMaxCount: number | undefined;

  //  readonly positions = input.required<xyz[]>();
  readonly data = input.required<IInstancedMeshData[]>();

  /** The number of instances */
  readonly count = input.required<number>();

  /** The instanced mesh object */
  readonly instancedMesh = signal<InstancedMesh>(
    new InstancedMesh(new BufferGeometry(), [], 0)
  );
  override object3D: WritableSignal<Object3D> = this.instancedMesh;
  #previousInstancedMesh: InstancedMesh | undefined = this.instancedMesh();

  /** Geometry and material signals */
  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = signal<Material | undefined>(undefined);

  constructor() {
    super();

    this.#initMaxCountChange();

    this.#initGeometry();
    this.#initMaterial();

    this.#initCountChange();

    this.#initDataChange();
  }
  #initMaxCountChange() {
    effect(
      () => {
        const maxCount = this.maxCount();

        if (this.#prevMaxCount === undefined || maxCount > this.#prevMaxCount) {
          console.warn('🌴🌴🌴 Recreating instanced mesh');
          if (this.#previousInstancedMesh) {
            this.#previousInstancedMesh.count = 0;
            this.#previousInstancedMesh.clear();
            this.#previousInstancedMesh.dispose();
            this.#previousInstancedMesh.removeFromParent();
          }
          // Recreate the instanced mesh and dispose of the old one
          const instancedMesh = new InstancedMesh(
            this.geometry(),
            this.material(),
            maxCount
          );

          this.instancedMesh.set(instancedMesh);

          this.#previousInstancedMesh = instancedMesh;
        }

        this.#prevMaxCount = maxCount;
      },
      { allowSignalWrites: true }
    );
  }
  #initGeometry() {
    effect(() => {
      const geometry = this.geometry();
      const instancedMesh = this.instancedMesh();
      if (geometry) {
        instancedMesh.geometry = geometry;
      }
    });
  }
  #initMaterial() {
    effect(() => {
      const material = this.material();
      const instancedMesh = this.instancedMesh();
      if (material) {
        instancedMesh.material = material;
      }
    });
  }

  #initCountChange() {
    effect(() => {
      const instancedMesh = this.instancedMesh();
      const count = this.count();
      const maxCount = this.maxCount();

      const newCount = Math.min(count, maxCount);

      instancedMesh.count = newCount;
    });
  }

  #eulerRotation = new Euler();
  #scaleVector = new Vector3();

  #initDataChange() {
    effect(() => {
      const instancedMesh = this.instancedMesh();
      const data = this.data();

      this.onDataChanged(data, instancedMesh);
    });
  }

  public onDataChanged(
    data: IInstancedMeshData[],
    instancedMesh: InstancedMesh
  ) {
    const eulerRotation = this.#eulerRotation;
    const scaleVector = this.#scaleVector;

    data.forEach((params, index) => {
      const matrix = new Matrix4();

      eulerRotation.set(
        params.rotation[0],
        params.rotation[1],
        params.rotation[2]
      );
      matrix.makeRotationFromEuler(eulerRotation);

      scaleVector.set(params.scale[0], params.scale[1], params.scale[2]);
      matrix.scale(scaleVector);

      matrix.setPosition(
        params.position[0],
        params.position[1],
        params.position[2]
      );

      instancedMesh.setMatrixAt(index, matrix);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
