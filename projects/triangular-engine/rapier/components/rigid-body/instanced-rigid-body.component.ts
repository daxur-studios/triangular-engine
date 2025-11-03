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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Rotation } from '@dimforge/rapier3d-compat';
import {
  BufferGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Object3D,
  Quaternion as ThreeQuaternion,
  Vector3,
  Vector3Tuple,
} from 'three';
import { RigidBodyComponent } from './rigid-body.component';
import {
  Object3DComponent,
  provideObject3DComponent,
  IMaterialComponent,
} from 'triangular-engine';
import { PhysicsService } from '../../services/physics.service';

// Geometry Change: Update instancedMesh.geometry and dispose of the old geometry.
// Material Change: Update instancedMesh.material and dispose of the old material.
// Position Change: Update instance matrices; no need to recreate.
// Count Increase: Dispose and recreate InstancedMesh with a higher count.
// Count Decrease: Adjust instancedMesh.count; no need to recreate.

export interface IInstancedRigidBodyData {
  position: Vector3;
  rotation: Rotation;
  scale: number | Vector3Tuple;
}

@Component({
  standalone: true,
  selector: 'instancedRigidBody',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(InstancedRigidBodyComponent)],
})
export class InstancedRigidBodyComponent
  extends Object3DComponent
  implements IMaterialComponent
{
  override emoji = '⪬';

  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  //#endregion

  /** The maximum number of instances*/
  readonly maxCount = input.required<number>();
  #prevMaxCount: number | undefined;

  readonly data = signal<IInstancedRigidBodyData[]>([]); // update based on rigid bodies?????

  /** The number of instances */
  readonly count = signal<number>(0);

  /** The instanced mesh object */
  readonly instancedMesh = signal<InstancedMesh>(
    new InstancedMesh(new BufferGeometry(), [], 0),
  );
  override object3D: WritableSignal<Object3D> = this.instancedMesh;
  #previousInstancedMesh: InstancedMesh | undefined = this.instancedMesh();

  /** Geometry and material signals */
  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = signal<Material | undefined>(undefined);

  readonly rigidBodies = viewChildren(RigidBodyComponent);
  readonly contentChildrenRigidBodies = contentChildren(RigidBodyComponent);
  readonly allRigidBodies = computed(() => {
    return [...this.rigidBodies(), ...this.contentChildrenRigidBodies()];
  });

  /**
   * In Three.js, frustum culling is an optimization technique where objects outside the camera's view are not rendered.
   * For instanced meshes, the bounding volume (usually a bounding box) determines whether the entire group of instances is within the camera's view.
   * If this bounding volume doesn't cover all instances, they may disappear when the camera moves, even if some instances are still within view.
   */
  // readonly instancedMeshBoundingBox = new Box3(
  //   new Vector3(-Infinity, -Infinity, -Infinity),
  // );

  constructor() {
    super();

    effect(() => {
      const allRigidBodies = this.allRigidBodies();

      const data: IInstancedRigidBodyData[] = [];

      allRigidBodies.forEach((rigidBody) => {
        const b = rigidBody.rigidBody();
        const translation = b?.translation();
        const r = b?.rotation();

        const position = new Vector3(
          translation?.x || 0,
          translation?.y || 0,
          translation?.z || 0,
        );
        const rotation = b?.rotation() || {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
        };
        const scale = rigidBody.scale() || 1;

        data.push({ position, rotation, scale });
      });

      this.count.set(data.length);
      this.data.set(data);
    });

    this.physicsService.stepped$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const data = this.data();

        data.forEach((instancedRigidBodyData, index) => {
          const rigidBody = this.allRigidBodies()[index];
          const b = rigidBody.rigidBody();
          if (!b) return;

          const position = b.translation();
          instancedRigidBodyData.position.x = position.x;
          instancedRigidBodyData.position.y = position.y;
          instancedRigidBodyData.position.z = position.z;

          const r = b.rotation();

          //  const rotation = rigidBody.rotation();
          const scale = rigidBody.scale() || 1;

          instancedRigidBodyData.rotation = r;
          instancedRigidBodyData.scale = scale;
        });

        // this.onDataChanged(data, this.instancedMesh());

        this.data.set([...data]);
      });

    this.#initMaxCountChange();

    this.#initGeometry();
    this.#initMaterial();

    this.#initCountChange();

    // this.#initInstancedMesh();
    //this.#initUpdateInstances();
    this.#initPositionChange();
    this.#initDataChange();
  }

  // #updateBoundingBox(data: IInstancedRigidBodyData[]) {
  //   const instancedMesh = this.instancedMesh();

  //   const boundingBox = this.instancedMeshBoundingBox;
  //   boundingBox.makeEmpty();

  //   const position = new Vector3();
  //   const matrix = new Matrix4();

  //   data.forEach((instanceData, index) => {
  //     instancedMesh.getMatrixAt(index, matrix);
  //     position.setFromMatrixPosition(matrix);
  //     boundingBox.expandByPoint(position);
  //   });

  //   // Optionally, expand the bounding box by the instance's scale
  //   const maxScale = Math.max(
  //     ...data.map((d) =>
  //       typeof d.scale === 'number' ? d.scale : Math.max(...d.scale),
  //     ),
  //   );
  //   boundingBox.expandByScalar(maxScale);

  //   // Update the bounding box to account for the instanced mesh's world position
  //   boundingBox.applyMatrix4(instancedMesh.matrixWorld);
  // }

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
        //  instancedMesh.geometry.boundingBox = this.instancedMeshBoundingBox;

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

      const newCount = Math.min(count, maxCount);

      instancedMesh.count = newCount;
    });
  }

  #initPositionChange() {}

  #tmpRotation = new ThreeQuaternion();
  #scaleVector = new Vector3();
  #tmpPosition = new Vector3();

  #initDataChange() {
    effect(() => {
      const instancedMesh = this.instancedMesh();
      const data = this.data();

      this.onDataChanged(data, instancedMesh);
      //  this.#updateBoundingBox(data);
    });
  }

  public onDataChanged(
    data: IInstancedRigidBodyData[],
    instancedMesh: InstancedMesh,
  ) {
    const tmpRotation = this.#tmpRotation;
    const scaleVector = this.#scaleVector;
    const tmpPosition = this.#tmpPosition;

    data.forEach((params, index) => {
      const matrix = new Matrix4();

      // eulerRotation.set(
      //   params.rotation.x,
      //   params.rotation.y,
      //   params.rotation.z,
      // );
      // matrix.makeRotationFromEuler(eulerRotation);
      // Create a Three.js quaternion from the Rapier quaternion
      tmpRotation.set(
        params.rotation.x,
        params.rotation.y,
        params.rotation.z,
        params.rotation.w,
      );

      matrix.makeRotationFromQuaternion(tmpRotation);

      const scale: Vector3Tuple =
        typeof params.scale === 'number'
          ? [params.scale, params.scale, params.scale]
          : params.scale;

      scaleVector.set(...scale);
      matrix.scale(scaleVector);

      // Copy world position
      tmpPosition.copy(params.position);

      // Convert world position to local position relative to the instancedMesh's parent
      if (instancedMesh.parent) {
        // instancedMesh.parent.updateMatrixWorld(true);
        instancedMesh.parent.worldToLocal(tmpPosition);
      }

      matrix.setPosition(tmpPosition);

      instancedMesh.setMatrixAt(index, matrix);
    });
    instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
