import { Component, effect, input, signal } from '@angular/core';
import {
  JointData,
  SphericalImpulseJoint,
  Vector,
} from '@dimforge/rapier3d-compat';
import { JointComponent } from './joint.component';

@Component({
  selector: 'sphericalJoint',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [],
})
export class SphericalJointComponent extends JointComponent {
  //#region Injected Dependencies

  //#endregion

  readonly anchor1 = input.required<Vector>();
  readonly anchor2 = input.required<Vector>();

  override readonly joint = signal<SphericalImpulseJoint | undefined>(
    undefined
  );

  constructor() {
    super();
    //this.#initCreateJoint();

    this.#anchor1();
    this.#anchor2();
  }

  override createJointData(): JointData {
    return JointData.spherical(this.anchor1(), this.anchor2());
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
