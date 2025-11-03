import { Component, effect, input, signal } from '@angular/core';
import {
  FixedImpulseJoint,
  JointData,
  Rotation,
  Vector,
} from '@dimforge/rapier3d-compat';
import { JointComponent } from './joint.component';

@Component({
    selector: 'fixedJoint',
    template: `<ng-content></ng-content>`,
    imports: [],
    providers: []
})
export class FixedJointComponent extends JointComponent {
  //#region Injected Dependencies

  //#endregion

  /** Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the local-space of the rigid-body. */
  readonly anchor1 = input.required<Vector>();
  /** The reference orientation of the joint wrt. the first rigid-body. */
  readonly frame1 = input.required<Rotation>();

  readonly anchor2 = input.required<Vector>();
  readonly frame2 = input.required<Rotation>();

  override readonly joint = signal<FixedImpulseJoint | undefined>(undefined);

  constructor() {
    super();
    //this.#initCreateJoint();

    this.#anchor1();
    this.#anchor2();
  }

  override createJointData(): JointData {
    return JointData.fixed(
      this.anchor1(),
      this.frame1(),
      this.anchor2(),
      this.frame2()
    );
  }

  #anchor1() {
    effect(() => {
      const anchor1 = this.anchor1();
      const joint = this.joint();

      if (!anchor1 || !joint) return;

      joint.setAnchor1(anchor1);
    });
  }

  #anchor2() {
    effect(() => {
      const anchor2 = this.anchor2();
      const joint = this.joint();

      if (!anchor2 || !joint) return;

      joint.setAnchor2(anchor2);
    });
  }

  // Anchor change -> update joint
  // Frame change -> re-create joint
  // Rigid body change -> re-create joint. Track previous rigid body and remove joint from it

  #createJoint() {}
  #updateJoint() {}
}
