import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  WritableSignal,
} from '@angular/core';
import { ImpulseJoint, JointData } from '@dimforge/rapier3d-compat';
import { getWorld } from '../../../models/getter.helper';
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
  standalone: true,
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
    effect(
      () => {
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

        const world = getWorld(this);

        const jointData = this.createJointData();

        // Create the joint
        const impulseJoint = world.createImpulseJoint(
          jointData,
          body1,
          body2,
          true
        );

        setTimeout(() => {
          // clear all velocities
          body1.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body2.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }, 2220);

        this.joint.set(impulseJoint);
      },
      { allowSignalWrites: true }
    );
  }

  #initContactsEnabled() {
    effect(() => {
      const contactsEnabled = this.contactsEnabled();
      const joint = this.joint();

      if (!joint || contactsEnabled === undefined) return;

      joint.setContactsEnabled(contactsEnabled);
    });
  }

  public destroyJoint() {
    const impulseJoint = this.joint();
    const world = this.physicsService.world$.value!;

    if (impulseJoint) {
      world.removeImpulseJoint(impulseJoint, true);
    }
  }

  ngOnDestroy(): void {
    this.destroyJoint();
  }
}
