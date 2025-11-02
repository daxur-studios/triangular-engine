import { Component, effect, input, signal } from '@angular/core';
import {
  ImpulseJoint,
  JointData,
  MotorModel,
  PrismaticImpulseJoint,
  Vector,
} from '@dimforge/rapier3d-compat';
import { JointComponent } from './joint.component';

@Component({
    selector: 'springJoint',
    template: `<ng-content></ng-content>`,
    imports: [],
    providers: []
})
export class SpringJointComponent extends JointComponent {
  //#region Injected Dependencies

  //#endregion

  /** Point where the joint is attached on the first rigid-body. Expressed in the local-space of the rigid-body. */
  readonly anchor1 = input.required<Vector>();
  /** Point where the joint is attached on the second rigid-body. Expressed in the local-space of the rigid-body. */
  readonly anchor2 = input.required<Vector>();

  /** Axis along which the spring operates (direction of linear movement) */
  readonly axis = input<Vector>({ x: 0, y: 1, z: 0 });

  /** Target distance for the spring (rest position along the axis) */
  readonly target = input<number>(0);

  /** Spring stiffness - how strongly it pulls toward the target position. Higher values pull faster towards the target. */
  readonly stiffness = input<number>(100);

  /** Spring damping - controls resistance to motion for smoother settling. Higher values make the spring more resistant to motion. */
  readonly damping = input<number>(10);

  /**
   * Motor model:
   * - 0: AccelerationBased
   * - 1: ForceBased (default, best for springs)
   */
  readonly motorModel = input<MotorModel>(MotorModel.ForceBased);

  override readonly joint = signal<ImpulseJoint | undefined>(undefined);

  constructor() {
    super();

    this.#initAnchor1();
    this.#initAnchor2();
    this.#initSpringConfig();
  }

  override createJointData(): JointData {
    return JointData.prismatic(this.axis(), this.anchor1(), this.anchor2());
  }

  override async destroyJoint() {
    const impulseJoint = this.joint();
    const world = await this.physicsService.worldPromise;

    if (impulseJoint) {
      world.removeImpulseJoint(impulseJoint, true);
    }

    // Reset local state
    this.joint.set(undefined);
  }

  #initAnchor1() {
    effect(() => {
      const anchor1 = this.anchor1();
      const joint = this.joint();

      if (!anchor1 || !joint) return;

      if (joint instanceof PrismaticImpulseJoint) {
        joint.setAnchor1(anchor1);
      }
    });
  }

  #initAnchor2() {
    effect(() => {
      const anchor2 = this.anchor2();
      const joint = this.joint();

      if (!anchor2 || !joint) return;

      if (joint instanceof PrismaticImpulseJoint) {
        joint.setAnchor2(anchor2);
      }
    });
  }

  #initSpringConfig() {
    effect(() => {
      const joint = this.joint();
      const target = this.target();
      const stiffness = this.stiffness();
      const damping = this.damping();
      const motorModel = this.motorModel();

      if (!joint) return;

      // Configure motor model
      if (joint instanceof PrismaticImpulseJoint) {
        joint.configureMotorModel(motorModel);
        joint.configureMotorPosition(target, stiffness, damping);
      }
    });
  }
}
