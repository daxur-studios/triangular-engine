import { Component, input } from '@angular/core';
import { Jolt } from '../jolt-physics/jolt-physics.service';
import { JoltVehicleWheelComponent } from './jolt-vehicle-wheel.component';
import {
  IVehicleDriverInput,
  JoltVehicleConstraintComponent,
} from './jolt-vehicle-constraint.component';

/**
 * Wheeled vehicle: a `WheeledVehicleController` with engine, transmission and
 * differentials driving a set of `joltWheeledWheel`s. Wheels are assigned
 * left/right into differentials by the sign of their local `position.x`
 * (negative = left, positive = right). Driver input forwards `forward`,
 * `steer`, `brake`, and `handBrake` straight through to the controller.
 */
@Component({
  selector: 'joltWheeledVehicle',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export class JoltWheeledVehicleComponent extends JoltVehicleConstraintComponent {
  /** Engine max torque in N·m. */
  readonly engineMaxTorque = input(1200);
  /** Engine idle RPM. */
  readonly engineMinRPM = input(800);
  /** Engine redline RPM. */
  readonly engineMaxRPM = input(6000);
  /** Auto transmission: gear ratios (forward), applied in ascending gear order. */
  readonly gearRatios = input<readonly number[]>([2.8, 1.9, 1.4, 1, 0.8]);
  /** Auto transmission: reverse gear ratios. */
  readonly reverseGearRatios = input<readonly number[]>([-2.4]);

  protected createControllerSettings(
    wheels: JoltVehicleWheelComponent[],
  ): Jolt.VehicleControllerSettings {
    const jolt = Jolt;
    const controller = new jolt.WheeledVehicleControllerSettings();

    const engine = controller.mEngine;
    engine.mMaxTorque = this.engineMaxTorque();
    engine.mMinRPM = this.engineMinRPM();
    engine.mMaxRPM = this.engineMaxRPM();
    engine.mNormalizedTorque = this.#torqueCurve(jolt);
    engine.mInertia = 0.5;

    const transmission = controller.mTransmission;
    transmission.mMode = jolt.ETransmissionMode_Auto;
    transmission.mGearRatios.clear();
    for (const ratio of this.gearRatios()) {
      transmission.mGearRatios.push_back(ratio);
    }
    transmission.mReverseGearRatios.clear();
    for (const ratio of this.reverseGearRatios()) {
      transmission.mReverseGearRatios.push_back(ratio);
    }
    transmission.mSwitchTime = 0.1;
    transmission.mClutchReleaseTime = 0.15;
    transmission.mClutchStrength = 4;
    transmission.mSwitchLatency = 0.1;
    transmission.mShiftUpRPM = 0.9 * this.engineMaxRPM();
    transmission.mShiftDownRPM = 0.35 * this.engineMaxRPM();

    controller.mDifferentialLimitedSlipRatio = 1.4;
    for (const [left, right] of this.#differentialPairs(wheels)) {
      const differential = new jolt.VehicleDifferentialSettings();
      differential.mLeftWheel = left;
      differential.mRightWheel = right;
      differential.mDifferentialRatio = 3.5;
      differential.mLeftRightSplit = 0.5;
      differential.mEngineTorqueRatio = 1;
      differential.mLimitedSlipRatio = 1.4;
      controller.mDifferentials.push_back(differential);
    }

    return controller;
  }

  /** Pairs wheels by side into left/right differentials, in DOM order. */
  #differentialPairs(
    wheels: JoltVehicleWheelComponent[],
  ): Array<readonly [number, number]> {
    const left: number[] = [];
    const right: number[] = [];
    wheels.forEach((wheel, index) => {
      if (wheel.position()[0] < 0) {
        left.push(index);
      } else {
        right.push(index);
      }
    });
    const pairs: Array<readonly [number, number]> = [];
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
      if (left[i] === undefined || right[i] === undefined) continue;
      pairs.push([left[i], right[i]]);
    }
    return pairs;
  }

  /** A simple rising torque curve: 0 @ idle, 1 @ ~60% RPM, back to 0.8 @ redline. */
  #torqueCurve(jolt: typeof Jolt): Jolt.LinearCurve {
    const curve = new jolt.LinearCurve();
    curve.AddPoint(0, 0.2);
    curve.AddPoint(0.4, 0.9);
    curve.AddPoint(0.6, 1);
    curve.AddPoint(1, 0.8);
    curve.Sort();
    return curve;
  }

  protected applyDriverInputToJolt(
    controller: Jolt.VehicleController,
    driver: IVehicleDriverInput,
  ): void {
    const wheeled = Jolt.castObject(
      controller,
      Jolt.WheeledVehicleController,
    );
    wheeled.SetDriverInput(
      driver.forward,
      driver.steer,
      driver.brake,
      driver.handBrake,
    );
  }
}