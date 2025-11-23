import {
  Component,
  WritableSignal,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  model,
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
  Vector3Tuple,
  EulerTuple,
  Color,
  ColorRepresentation,
} from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';

// Geometry Change: Update instancedMesh.geometry and dispose of the old geometry.
// Material Change: Update instancedMesh.material and dispose of the old material.
// Position Change: Update instance matrices; no need to recreate.
// Count Increase: Dispose and recreate InstancedMesh with a higher count.
// Count Decrease: Adjust instancedMesh.count; no need to recreate.

export interface IInstancedMeshData<DATA = any> {
  position: Vector3Tuple;
  rotation: EulerTuple;
  scale: Vector3Tuple;
  color?: ColorRepresentation;
  data?: DATA;
}

/**
 * Instanced mesh component.
 *
 * @example
 * <instancedMesh [geometry]="geometry" [material]="material" [maxCount]="1000" [data]="data" [count]="data.length" [growStep]="100">
 * </instancedMesh>
 */
@Component({
  standalone: true,
  selector: 'instancedMesh',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(InstancedMeshComponent)],
})
export class InstancedMeshComponent extends Object3DComponent {
  override emoji = '🧩';

  /** The maximum number of instances*/
  readonly maxCount = model.required<number>();
  #prevMaxCount: number | undefined;

  //  readonly positions = input.required<xyz[]>();
  readonly data = model.required<IInstancedMeshData[]>();

  /** The number of instances */
  readonly count = input.required<number>();

  /**
   * Controls how much to increase the maxCount by when the current count reaches the limit.
   *
   * Default is 1, meaning the maxCount is increased by 1 every time the current count reaches the limit.
   *
   * For example, if initial maxCount is 100 and growStep is 100:
   * - When count reaches 100, maxCount increases to 200.
   * - When count reaches 200, maxCount increases to 300, etc.
   *
   * Set to 0 or undefined to disable auto-growing.
   */
  readonly growStep = input<number>(1);

  readonly frustumCulled = input<boolean>();

  /** The instanced mesh object */
  readonly instancedMesh = signal<InstancedMesh>(
    new InstancedMesh(new BufferGeometry(), [], 0),
  );
  override object3D: WritableSignal<Object3D> = this.instancedMesh;
  #previousInstancedMesh: InstancedMesh | undefined = this.instancedMesh();

  /** Geometry and material signals */
  readonly geometry = model<BufferGeometry | undefined>(undefined);
  readonly material = model<Material | undefined>(undefined);

  constructor() {
    super();

    this.#initMaxCountChange();

    this.#initGeometry();
    this.#initMaterial();

    this.#initCountChange();

    this.#initDataChange();

    this.#initFrustumCulled();
  }
  #initMaxCountChange() {
    effect(() => {
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
          maxCount,
        );

        this.instancedMesh.set(instancedMesh);

        this.#previousInstancedMesh = instancedMesh;
      }

      this.#prevMaxCount = maxCount;
    });
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
      const growStep = this.growStep();

      let newMaxCount = maxCount;

      // Auto-grow maxCount if growStep is enabled and count exceeds current maxCount
      if (growStep && growStep > 0 && count >= maxCount) {
        newMaxCount = maxCount + growStep;
        this.maxCount.set(newMaxCount);
      }

      const newCount = Math.min(count, newMaxCount);
      instancedMesh.count = newCount;
    });
  }

  #eulerRotation = new Euler();
  #scaleVector = new Vector3();
  #color = new Color();

  #initDataChange() {
    effect(() => {
      const instancedMesh = this.instancedMesh();

      // Change can be either detected by data ref change, or same data array, but it's been pushed to, so it's length changes
      const data = this.data();
      const count = this.count();

      this.onDataChanged(data, instancedMesh);
    });
  }

  public onDataChanged(
    data: IInstancedMeshData[],
    instancedMesh: InstancedMesh,
  ) {
    const eulerRotation = this.#eulerRotation;
    const scaleVector = this.#scaleVector;

    data.forEach((params, index) => {
      const matrix = new Matrix4();

      eulerRotation.set(
        params.rotation[0],
        params.rotation[1],
        params.rotation[2],
      );
      matrix.makeRotationFromEuler(eulerRotation);

      scaleVector.set(params.scale[0], params.scale[1], params.scale[2]);
      matrix.scale(scaleVector);

      matrix.setPosition(
        params.position[0],
        params.position[1],
        params.position[2],
      );

      instancedMesh.setMatrixAt(index, matrix);

      if (params.color !== undefined) {
        this.#color.set(params.color);
        instancedMesh.setColorAt(index, this.#color);
      }
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  #initFrustumCulled() {
    effect(() => {
      const frustumCulled = this.frustumCulled();
      const instancedMesh = this.instancedMesh();
      if (frustumCulled !== undefined) {
        instancedMesh.frustumCulled = frustumCulled;
      }
    });
  }
}
