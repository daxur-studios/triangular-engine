import { Component } from '@angular/core';
import { Jolt } from '../jolt-physics/jolt-physics.service';
import { JoltVehicleWheelComponent } from './jolt-vehicle-wheel.component';
import {
  IVehicleDriverInput,
  JoltVehicleConstraintComponent,
} from './jolt-vehicle-constraint.component';

/**
 * Tracked vehicle: a `TrackedVehicleController` with two independent tracks
 * (left / right) and ray-cast suspension pads. Wheels declare their side via
 * the `track` input (0 = left, 1 = right) and are grouped into the matching
 * `VehicleTrackSettings`. Driver input forwards `forward`, `steer`, and
 * `brake`; steering is expressed as a left/right track ratio split so the
 * tank spins in place when one side moves opposite the other.
 */
@Component({
  selector: 'joltTrackedVehicle',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export class JoltTrackedVehicleComponent extends JoltVehicleConstraintComponent {
  protected createControllerSettings(
    wheels: JoltVehicleWheelComponent[],
  ): Jolt.VehicleControllerSettings {
    const jolt = Jolt;
    const controller = new jolt.TrackedVehicleControllerSettings();

    const trackBuckets = new Map<number, number[]>();
    for (let index = 0; index < wheels.length; index++) {
      const side = wheels[index].track();
      const bucket = trackBuckets.get(side) ?? [];
      bucket.push(index);
      trackBuckets.set(side, bucket);
    }

    const trackCount = 2;
    for (let t = 0; t < trackCount; t++) {
      const track = controller.get_mTracks(t);
      const wheelIndices = trackBuckets.get(t) ?? [];
      for (const index of wheelIndices) {
        track.mWheels.push_back(index);
      }
      track.mDrivenWheel = wheelIndices.length > 0 ? wheelIndices[0] : -1;
      track.mDifferentialRatio = 1;
    }

    return controller;
  }

  protected applyDriverInputToJolt(
    controller: Jolt.VehicleController,
    driver: IVehicleDriverInput,
  ): void {
    const tracked = Jolt.castObject(
      controller,
      Jolt.TrackedVehicleController,
    );
    // Left side slows as we steer right (and vice versa); opposite signs let
    // the tank pivot about its center. Ratios stay in [-1, 1].
    const leftRatio = Math.min(1, Math.max(-1, driver.forward * (1 - driver.steer)));
    const rightRatio = Math.min(1, Math.max(-1, driver.forward * (1 + driver.steer)));
    tracked.SetDriverInput(
      driver.forward,
      leftRatio,
      rightRatio,
      driver.brake,
    );
  }
}