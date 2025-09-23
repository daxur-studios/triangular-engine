import { Component, effect, inject, input, signal } from '@angular/core';
import RAPIER, {
  RigidBody,
  RigidBodyDesc,
  Vector,
} from '@dimforge/rapier3d-compat';
import { GroupComponent, provideObject3DComponent } from '../../object-3d';

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  Group,
  Quaternion,
  QuaternionTuple,
  Vector3,
  Vector3Tuple,
} from 'three';
import { PhysicsService } from '../../../services';

@Component({
  selector: 'rigidBody',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,

  providers: [provideObject3DComponent(RigidBodyComponent)],
})
export class RigidBodyComponent extends GroupComponent {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  //#endregion

  /**
   * Examples, use number or enum:
   * - Dynamic = 0
   * - Fixed = 1
   * - KinematicPositionBased = 2
   * - KinematicVelocityBased = 3
   */
  readonly rigidBodyType = input.required<RAPIER.RigidBodyType>();

  readonly id = input<string | undefined>(undefined);
  //#region Physical Properties
  readonly mass = input<number>();
  readonly angularDamping = input<number>();
  readonly linearDamping = input<number>();
  //#endregion

  /** Linear velocity vector in meters per second */
  readonly velocity = input<Vector3Tuple>();

  readonly rigidBodyRotation = input<QuaternionTuple | undefined>(undefined);

  /**
   * Optional, update an instanced mesh matrix with the physics body's position and rotation.
   */
  //readonly instancedMeshData = model<IInstancedMeshData>();

  readonly rigidBodyDesc = signal<RigidBodyDesc | undefined>(undefined);
  readonly rigidBody = signal<RigidBody | undefined>(undefined);
  readonly rigidBody$ = toObservable(this.rigidBody);

  constructor() {
    super();

    this.#initId();
    this.#initUserData();

    this.#initRigidBodyDesc();
    this.#initRigidBodyPosition();
    this.#initRigidBodyRotation();
    this.#initRigidBodyRotationV2();

    //#region Physical Properties
    this.#initMass();
    this.#initAngularDamping();
    this.#initLinearDamping();
    //#endregion
    this.#initVelocity();

    this.#initRigidBody();

    this.#initSyncGroupPositionWithPhysicsPosition();
  }

  #initUserData() {
    effect(() => {
      const rigidBody = this.rigidBody();
      const group = this.group();
      if (!rigidBody) return;

      rigidBody.userData ||= {};
      (rigidBody.userData as IRigidBodyUserData).group = group;

      group.userData['rigidBody'] = rigidBody;
    });
  }

  #initId() {
    effect(
      () => {
        const id = this.id();
        const rigidBody = this.rigidBody();
        if (!id || !rigidBody) return;

        this.physicsService.setRigidBodyById(id, rigidBody);
      },
      { allowSignalWrites: true },
    );
  }

  #initRigidBodyDesc() {
    effect(
      () => {
        const rigidBodyDesc = new RigidBodyDesc(this.rigidBodyType());
        this.rigidBodyDesc.set(rigidBodyDesc);
      },
      { allowSignalWrites: true },
    );
  }

  #initRigidBodyPosition() {
    effect(() => {
      const rigidBodyDesc = this.rigidBodyDesc();
      if (!rigidBodyDesc) return;

      //#region Use Absolute Position
      const group = this.group();
      group.updateMatrixWorld();

      // Create a Vector3 to store the world position
      const worldPosition = new Vector3();

      // Get the world position of the mesh
      group.getWorldPosition(worldPosition);
      //#endregion

      rigidBodyDesc.setTranslation(...worldPosition.toArray());
    });
  }

  #initRigidBodyRotation() {
    effect(() => {
      const rigidBodyDesc = this.rigidBodyDesc();
      if (!rigidBodyDesc) return;

      const quaternion = this.group().quaternion;

      rigidBodyDesc.setRotation(quaternion);
    });
  }

  #initRigidBodyRotationV2() {
    effect(() => {
      const rigidBodyRotation = this.rigidBodyRotation();
      const rigidBody = this.rigidBody();
      if (!rigidBodyRotation || !rigidBody) return;

      rigidBody.setRotation(
        {
          x: rigidBodyRotation[0],
          y: rigidBodyRotation[1],
          z: rigidBodyRotation[2],
          w: rigidBodyRotation[3],
        },
        true,
      );
    });
  }

  //#region Physical Properties
  #initMass() {
    effect(() => {
      const mass = this.mass();
      const rigidBodyDesc = this.rigidBodyDesc();

      if (!rigidBodyDesc || mass === undefined) return;

      rigidBodyDesc.mass = mass;
    });
  }
  #initAngularDamping() {
    effect(() => {
      const angularDamping = this.angularDamping();
      const rigidBodyDesc = this.rigidBodyDesc();

      if (!rigidBodyDesc || angularDamping === undefined) return;

      rigidBodyDesc.setAngularDamping(angularDamping);
    });
  }
  #initLinearDamping() {
    effect(() => {
      const linearDamping = this.linearDamping();
      const rigidBodyDesc = this.rigidBodyDesc();

      if (!rigidBodyDesc || linearDamping === undefined) return;

      rigidBodyDesc.setLinearDamping(linearDamping);
    });
  }
  //#endregion

  #initVelocity() {
    effect(() => {
      const velocity = this.velocity();
      const rigidBody = this.rigidBody();
      if (!velocity || !rigidBody) return;

      rigidBody.setLinvel(
        {
          x: velocity[0],
          y: velocity[1],
          z: velocity[2],
        },
        true,
      );
    });
  }

  #initRigidBody() {
    effect(
      async () => {
        const rigidBodyDesc = this.rigidBodyDesc();
        if (!rigidBodyDesc) return;

        const world = await this.physicsService.worldPromise;

        const rigidBody = world.createRigidBody(rigidBodyDesc);

        this.rigidBody.set(rigidBody);
      },
      { allowSignalWrites: true },
    );
  }
  #initSyncGroupPositionWithPhysicsPosition() {
    this.physicsService.stepped$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const rigidBody = this.rigidBody();
        if (!rigidBody) return;

        const translation = rigidBody.translation();
        const rotation = rigidBody.rotation();

        const group = this.group();

        // Create vectors and quaternions from the physics body's translation and rotation
        const physicsPosition = new Vector3(
          translation.x,
          translation.y,
          translation.z,
        );
        const worldQuaternion = new Quaternion(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        );

        if (group.parent) {
          // Update the parent's world matrix to ensure it's up-to-date
          // group.parent.updateMatrixWorld(true);

          // Convert world position to local position
          group.parent.worldToLocal(physicsPosition);

          // Get the inverse of the parent's world quaternion
          const parentWorldQuaternion = new Quaternion();
          group.parent.getWorldQuaternion(parentWorldQuaternion);
          parentWorldQuaternion.invert();

          // Convert world rotation to local rotation
          worldQuaternion.premultiply(parentWorldQuaternion);
        }

        // Apply the local position and rotation to the group
        group.position.copy(physicsPosition);
        group.quaternion.copy(worldQuaternion);
      });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();

    const rigidBody = this.rigidBody();
    if (rigidBody) {
      this.physicsService.world$.value?.removeRigidBody(rigidBody);
    }
  }
}

export function getRigidBodyUserData(
  rigidBody: RAPIER.RigidBody,
): IRigidBodyUserData | undefined {
  return rigidBody.userData as IRigidBodyUserData | undefined;
}

export interface IRigidBodyUserData {
  group: Group;
  customForcesToApply?: CustomForces;
}

type ForceToApply = { force: Vector } | { force: Vector; point: Vector };

export type CustomForces = {
  [v in CustomForceEnum]?: ForceToApply[] | undefined;
};

export enum CustomForceEnum {
  SphericalGravity = 'spherical-gravity',
  EngineThrust = 'engine-thrust',
}

/**
 * Update the custom forces to apply to a rigid body.
 * Allows for multiple custom forces to be applied to a single rigid body, even if forces are reset.
 * @param rigidBody The rigid body to update
 * @param id The custom force id
 * @param force The force to apply
 */
export function updateRigidBodyCustomForcesToApply(
  rigidBody: RAPIER.RigidBody,
  id: CustomForceEnum,
  force: ForceToApply[] | undefined,
) {
  const fallback: IRigidBodyUserData = {
    group: undefined!,
    customForcesToApply: {},
  };

  const userData = (rigidBody.userData ||= fallback) as IRigidBodyUserData;
  userData.customForcesToApply ||= {};
  userData.customForcesToApply[id] = force;
}

export function applyAllCustomForces(rigidBody: RAPIER.RigidBody) {
  rigidBody.resetForces(true);
  rigidBody.resetTorques(true);

  const userData = rigidBody.userData as IRigidBodyUserData;

  if (!userData || !userData.customForcesToApply) return;

  const forces = userData.customForcesToApply;

  for (const id in forces) {
    const force = forces[id as CustomForceEnum];
    if (!force) continue;

    const addUserForceHelper = (force: ForceToApply) => {
      if ('point' in force && force.point) {
        rigidBody.addForceAtPoint(force.force, force.point, true);
      } else {
        rigidBody.addForce(force.force, true);
      }
    };

    if (Array.isArray(force)) {
      force.forEach((f) => {
        addUserForceHelper(f);
      });
    } else {
      addUserForceHelper(force);
    }
  }
}
