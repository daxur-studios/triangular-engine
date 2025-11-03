import { Component, input, model } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IJoltMetadata, Jolt } from '../jolt-physics/jolt-physics.service';
import {
  JoltConstraintComponent,
  provideJoltConstraintComponent,
} from './jolt-constraint.component';
import { distinctUntilChanged } from 'rxjs';
import { Vector3Tuple } from 'three';
import { LAYER_NON_MOVING } from '../example';
import { BehaviorSubject } from 'rxjs';

@Component({
  selector: 'jolt-hinge-constraint',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideJoltConstraintComponent(JoltHingeConstraintComponent)],
})
export class JoltHingeConstraintComponent extends JoltConstraintComponent {
  /**
   * Anchor point in world space where the hinge is located.
   * Defaults to [0, 0, 0]
   */
  readonly anchor = model<Vector3Tuple>([0, 0, 0]);

  /**
   * Hinge axis direction (will be normalized).
   * Defaults to [0, 1, 0] (Y-axis)
   */
  readonly axis = model<Vector3Tuple>([0, 1, 0]);

  /**
   * Minimum angle limit in radians. Set to undefined for no limit.
   */
  readonly limitsMin = model<number>();

  /**
   * Maximum angle limit in radians. Set to undefined for no limit.
   */
  readonly limitsMax = model<number>();

  /**
   * Motor state: 'velocity' for velocity motor, 'off' for no motor
   */
  readonly motorState = model<'velocity' | 'off'>('off');

  /**
   * Target angular velocity in rad/s when motor is enabled
   * @default - 0
   */
  readonly targetAngularVelocity = model<number>();

  /**
   * Maximum friction torque for the motor
   * @default - 1000
   */
  readonly maxFrictionTorque = model<number>();

  get hingeConstraint() {
    return this.constraint$.value as Jolt.HingeConstraint | undefined;
  }

  constructor() {
    super();
    this.#init();
  }

  #init() {
    const metaData = this.physicsService.metaData$.value;
    if (!metaData) {
      throw new Error('No metadata found');
    }
    this.#createConstraint(metaData);
  }

  public override dispose() {
    // Call parent dispose
    super.dispose();
  }

  /**
   * Returns true if there's already a constraint created for the same configuration
   */
  #isDistinct(
    a: readonly [Jolt.Body, Jolt.Body] | undefined,
    b: readonly [Jolt.Body, Jolt.Body] | undefined,
  ): boolean {
    if (!a || !b) return true;
    if (a[0] !== b[0]) return true;
    if (a[1] !== b[1]) return true;
    return false;
  }

  #createConstraint(metaData: IJoltMetadata) {
    this.joltBodyPair$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged((a, b) => !this.#isDistinct(a, b)),
      )
      .subscribe((bodies) => {
        // If bodies changed to undefined or invalid, dispose existing constraint
        if (!bodies) {
          this.dispose();
          return;
        }

        const bodyA = bodies[0];
        let bodyB = bodies[1];

        if (!bodyA) {
          this.dispose();
          return;
        }

        // Dispose existing constraint before creating new one
        const existingConstraint = this.constraint$.value;
        if (existingConstraint) {
          this.dispose();
        }

        if (!bodyB) {
          // No body B, can't create constraint
          this.dispose();
          return;
        }

        try {
          const hingeSettings = new Jolt.HingeConstraintSettings();

          const anchorPoint = this.anchor();
          const axisVec = this.axis();

          // Set anchor points
          const anchorRVec = new Jolt.RVec3(
            anchorPoint[0],
            anchorPoint[1],
            anchorPoint[2],
          );
          hingeSettings.mPoint1 = anchorRVec;
          hingeSettings.mPoint2 = anchorRVec;

          // Set hinge axes (normalized)
          const axisVec3 = new Jolt.Vec3(axisVec[0], axisVec[1], axisVec[2]);
          const normalizedAxis = axisVec3.Normalized();
          hingeSettings.mHingeAxis1 = normalizedAxis;
          hingeSettings.mHingeAxis2 = normalizedAxis;
          Jolt.destroy(axisVec3);

          // Set limits if provided
          const minLimit = this.limitsMin();
          const maxLimit = this.limitsMax();
          if (minLimit !== undefined && maxLimit !== undefined) {
            hingeSettings.mLimitsMin = minLimit;
            hingeSettings.mLimitsMax = maxLimit;
          }

          // Set motor settings if enabled
          // TODO: Fix motor settings property names based on actual Jolt API
          // const motorState = this.motorState();
          // if (motorState === 'velocity') {
          //   hingeSettings.mMotorSettings.mMotorState = Jolt.EMotorState_Velocity;
          //   hingeSettings.mMotorSettings.mTargetAngularVelocity = this.targetAngularVelocity();
          //   hingeSettings.mMotorSettings.mMaxTorque = this.maxFrictionTorque();
          // }

          // Set space to world space for more predictable behavior
          hingeSettings.mSpace = Jolt.EConstraintSpace_WorldSpace;

          // Create constraint between the two bodies
          const constraint = hingeSettings.Create(bodyA, bodyB);

          Jolt.destroy(hingeSettings);
          Jolt.destroy(anchorRVec);
          Jolt.destroy(normalizedAxis);

          metaData.physicsSystem.AddConstraint(constraint);

          this.constraint$.next(constraint);

          // Register constraint
          this.physicsService.registerConstraint(constraint, bodyA, bodyB);

          // Set up motor if enabled (using the constraint's motor methods like in the demo)
          const motorState = this.motorState();
          if (motorState === 'velocity') {
            // Cast to HingeConstraint to access motor methods
            const hinge = Jolt.castObject(constraint, Jolt.HingeConstraint);
            hinge.SetMotorState(Jolt.EMotorState_Velocity);
            hinge.SetTargetAngularVelocity(this.targetAngularVelocity() ?? 0);
          }
        } catch (error) {
          console.error('Failed to create hinge constraint:', error);
        }
      });
  }
}
