import { Component, input } from '@angular/core';
import { Jolt } from '../jolt-physics/jolt-physics.service';
import {
  JoltVehicleWheelComponent,
  provideJoltVehicleWheelComponent,
} from './jolt-vehicle-wheel.component';

/**
 * Declarative wheeled wheel: builds a `WheelSettingsWV` (Jolt's wheeled-
 * vehicle wheel). Includes rotational inertia, steering and brake torque so it
 * supports actual rolling vehicles. Friction is exposed as flat
 * `longitudinalFriction` / `lateralFriction` coefficients, converted into the
 * constant control curves WheeledVehicleController expects (slip → friction).
 */
@Component({
  selector: 'joltWheeledWheel',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideJoltVehicleWheelComponent(JoltWheeledWheelComponent)],
})
export class JoltWheeledWheelComponent extends JoltVehicleWheelComponent {
  /** Rotary inertia of one wheel about its spin axis (kg·m²). */
  readonly inertia = input(6);
  /** Angular damping of the free-spinning wheel (0..1). */
  readonly angularDamping = input(0.3);
  /** Maximum front-wheel steer angle, radians. */
  readonly maxSteerAngle = input(0);
  /** Constant longitudinal (drive/brake) traction coefficient. */
  readonly longitudinalFriction = input(1.6);
  /** Constant lateral (cornering) traction coefficient. */
  readonly lateralFriction = input(1.6);
  /** Wheel-brake torque amount (0..1) the controller applies when braking. */
  readonly maxBrakeTorque = input(1);
  /** Hand-brake torque amount (0..1) the controller applies when hand-braking. */
  readonly maxHandBrakeTorque = input(1);

  createSettings(jolt: typeof Jolt): Jolt.WheelSettingsWV {
    const wheels = new jolt.WheelSettingsWV();
    this.applyBaseSettings(wheels, jolt);
    wheels.mInertia = this.inertia();
    wheels.mAngularDamping = this.angularDamping();
    wheels.mMaxSteerAngle = this.maxSteerAngle();
    wheels.mMaxBrakeTorque = this.maxBrakeTorque();
    wheels.mMaxHandBrakeTorque = this.maxHandBrakeTorque();
    wheels.mLongitudinalFriction = this.#flatCurve(
      jolt,
      this.longitudinalFriction(),
    );
    wheels.mLateralFriction = this.#flatCurve(jolt, this.lateralFriction());
    return wheels;
  }

  /** Slip → friction curve with a single constant value at every slip. */
  #flatCurve(jolt: typeof Jolt, friction: number): Jolt.LinearCurve {
    const curve = new jolt.LinearCurve();
    curve.AddPoint(0, friction);
    curve.AddPoint(1, friction);
    curve.Sort();
    return curve;
  }
}