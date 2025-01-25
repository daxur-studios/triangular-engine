import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
  Type,
  WritableSignal,
} from '@angular/core';
import { Object3DComponent } from '../../object-3d';
import { RigidBodyComponent } from '../rigid-body/rigid-body.component';
import RAPIER, { Rotation } from '@dimforge/rapier3d-compat';
import { PhysicsService } from '../../../services';
import { QuaternionTuple, Vector3Tuple } from 'three';

export function provideColliderComponent<T extends ColliderComponent>(
  colliderComponent: Type<T>
) {
  return [{ provide: ColliderComponent, useValue: colliderComponent }];
}

@Component({
  selector: 'collider',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
})
export class ColliderComponent implements OnDestroy {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  readonly object3DComponent = inject(Object3DComponent);
  //#endregion
  readonly id = input<string | undefined>();

  readonly position = input<Vector3Tuple>([0, 0, 0]);
  readonly rotation = input<QuaternionTuple>();

  //#region Physical Properties
  readonly mass = input<number>();
  readonly friction = input<number>();
  readonly restitution = input<number>();
  readonly density = input<number>();
  //#endregion

  readonly colliderDesc = signal<RAPIER.ColliderDesc | undefined>(undefined);

  readonly collider = signal<RAPIER.Collider | undefined>(undefined);

  constructor() {
    this.#initCollider();
    this.#initColliderPosition();
    this.#initColliderRotation();

    //#region Physical Properties
    this.#initMass();
    this.#initFriction();
    this.#initRestitution();
    this.#initDensity();
    //#endregion
  }

  #initCollider() {
    effect(
      () => {
        const parentRigidBodyComponent = this.#getParentAsRigidBodyComponent();
        if (!parentRigidBodyComponent) return;

        const colliderDesc = this.colliderDesc();

        if (!colliderDesc) return;

        const world = this.physicsService.world$.value!;

        const rigidBody = parentRigidBodyComponent.rigidBody();

        const collider = world.createCollider(colliderDesc, rigidBody);

        this.collider.set(collider);
      },
      { allowSignalWrites: true }
    );
  }

  #initColliderPosition() {
    const translation = new RAPIER.Vector3(0, 0, 0);

    effect(() => {
      const collider = this.collider();
      if (!collider) return;

      const position = this.position();

      translation.x = position[0];
      translation.y = position[1];
      translation.z = position[2];

      collider.setTranslationWrtParent(translation);
    });
  }

  #initColliderRotation() {
    effect(() => {
      const collider = this.collider();
      const rotation = this.rotation();

      if (!collider || !rotation) return;

      const r: Rotation = {
        x: rotation[0],
        y: rotation[1],
        z: rotation[2],
        w: rotation[3],
      };

      collider.setRotationWrtParent(r);
    });
  }

  #getParentAsRigidBodyComponent() {
    if (this.object3DComponent instanceof RigidBodyComponent) {
      return this.object3DComponent;
    }
    return this.#findClosestRigidBodyComponent();
  }

  /**
   * Traverse upwards to find the closest rigid body component
   */
  #findClosestRigidBodyComponent() {
    let parent: RigidBodyComponent | Object3DComponent | null =
      this.object3DComponent;

    const maxDepth = 10;
    let depth = 0;

    while (parent) {
      if (parent instanceof RigidBodyComponent) {
        return parent;
      }
      parent = parent.parent;
      depth++;
      if (depth > maxDepth) {
        console.warn('Max depth reached, cannot find rigid body component');
        return null;
      }
    }
    return undefined;
  }

  //#region Physical Properties
  #initMass() {
    effect(() => {
      const mass = this.mass();
      const collider = this.collider();
      if (!collider || mass === undefined) return;

      collider.setMass(mass);
    });
  }

  #initFriction() {
    effect(() => {
      const friction = this.friction();
      const collider = this.collider();
      if (!collider || friction === undefined) return;

      collider.setFriction(friction);
    });
  }
  #initRestitution() {
    effect(() => {
      const restitution = this.restitution();
      const collider = this.collider();
      if (!collider || restitution === undefined) return;

      collider.setRestitution(restitution);
    });
  }
  #initDensity() {
    effect(() => {
      const density = this.density();
      const collider = this.collider();
      if (!collider || density === undefined) return;

      collider.setDensity(density);
    });
  }
  //#endregion

  ngOnDestroy(): void {
    const collider = this.collider();
    const world = this.physicsService.world$.value!;

    if (collider && world) {
      world.removeCollider(collider, true);
    }
  }
}
