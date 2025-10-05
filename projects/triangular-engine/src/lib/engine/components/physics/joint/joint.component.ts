import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  WritableSignal,
} from '@angular/core';
import { ImpulseJoint, JointData } from '@dimforge/rapier3d-compat';
import { PhysicsService } from '../../../services';
import { RigidBodyComponent } from '../rigid-body/rigid-body.component';

type RigidBodyInputTuple =
  | [string, string]
  | [RigidBodyComponent, RigidBodyComponent]
  | [string, RigidBodyComponent]
  | [RigidBodyComponent, string];

@Component({
  selector: 'joint',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [],
})
export abstract class JointComponent implements OnDestroy {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  //#endregion

  /**
   * Provide reference to the rigid bodies, or their ids. If the rigid bodies are not found, the joint will not be created between them.
   */
  readonly rigidBodies = input.required<RigidBodyInputTuple>();
  /** Controls whether contacts are computed between colliders attached to the rigid-bodies linked by this joint. */
  readonly contactsEnabled = input<boolean>();

  abstract readonly joint: WritableSignal<ImpulseJoint | undefined>; //(undefined);

  constructor() {
    this.#initCreateJoint();
    this.#initContactsEnabled();
  }

  abstract createJointData(): JointData;

  #initCreateJoint() {
    effect(async () => {
      const joint = this.joint();
      if (joint) return;

      const rigidBodies = this.rigidBodies();

      const body1 =
        typeof rigidBodies[0] === 'string'
          ? this.physicsService.getRigidBodyById(rigidBodies[0])()
          : rigidBodies[0].rigidBody();

      const body2 =
        typeof rigidBodies[1] === 'string'
          ? this.physicsService.getRigidBodyById(rigidBodies[1])()
          : rigidBodies[1].rigidBody();

      if (!body1 || !body2) return;

      const world = await this.physicsService.worldPromise;

      const jointData = this.createJointData();

      // Create the joint
      const impulseJoint = world.createImpulseJoint(
        jointData,
        body1,
        body2,
        true,
      );

      // // Schedule a small stabilization after joint creation. Guard against
      // // bodies being removed/destroyed before this fires.
      // this.#clearVelocityTimeout = setTimeout(() => {
      //   try {
      //     if (body1.isValid()) {
      //       body1.setLinvel({ x: 0, y: 0, z: 0 }, true);
      //     }
      //     if (body2.isValid()) {
      //       body2.setLinvel({ x: 0, y: 0, z: 0 }, true);
      //     }
      //   } catch {
      //     // Ignore WASM errors from stale bodies
      //   }
      // }, 1);

      this.joint.set(impulseJoint);
    });
  }

  #initContactsEnabled() {
    effect(() => {
      const contactsEnabled = this.contactsEnabled();
      const joint = this.joint();

      if (!joint || contactsEnabled === undefined) return;

      joint.setContactsEnabled(contactsEnabled);
    });
  }

  public async destroyJoint() {
    const impulseJoint = this.joint();
    const world = await this.physicsService.worldPromise;

    if (impulseJoint) {
      world.removeImpulseJoint(impulseJoint, true);
    }

    // Reset local state
    this.joint.set(undefined);
  }

  ngOnDestroy(): void {
    // Clear any pending timer to avoid calling Rapier on invalid bodies
    if (this.#clearVelocityTimeout) {
      clearTimeout(this.#clearVelocityTimeout);
      this.#clearVelocityTimeout = undefined;
    }

    this.destroyJoint();
  }

  // Keep reference to the stabilization timeout so it can be cleared on destroy
  #clearVelocityTimeout: ReturnType<typeof setTimeout> | undefined;
}
