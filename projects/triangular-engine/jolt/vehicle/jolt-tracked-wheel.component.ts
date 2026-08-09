import { Component, input } from '@angular/core';
import { Jolt } from '../jolt-physics/jolt-physics.service';
import {
  JoltVehicleWheelComponent,
  provideJoltVehicleWheelComponent,
} from './jolt-vehicle-wheel.component';

/**
 * Declarative tracked wheel: builds a `WheelSettingsTV` (Jolt's tracked-
 * vehicle wheel). Tracked wheels are virtual suspension pads without a rolling
 * tire physics — ideal for non-rolling skid/rubber pads and tracked chassis.
 * Assign it a `track` (0 = left, 1 = right) to bind it to one of the
 * controller's two independent drive tracks.
 */
@Component({
  selector: 'joltTrackedWheel',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideJoltVehicleWheelComponent(JoltTrackedWheelComponent)],
})
export class JoltTrackedWheelComponent extends JoltVehicleWheelComponent {
  /** Longitudinal (drive/brake) friction coefficient. Default: 1 (grippy, non-rolling pad). */
  readonly longitudinalFriction = input(1.9);
  /** Lateral (resist sliding sideways) friction coefficient. */
  readonly lateralFriction = input(1.9);

  createSettings(jolt: typeof Jolt): Jolt.WheelSettingsTV {
    const wheels = new jolt.WheelSettingsTV();
    this.applyBaseSettings(wheels, jolt);
    wheels.mLongitudinalFriction = this.longitudinalFriction();
    wheels.mLateralFriction = this.lateralFriction();
    return wheels;
  }
}