import {
  Component,
  forwardRef,
  inject,
  Injector,
  input,
  OnDestroy,
  Type,
} from '@angular/core';
import { Vector3Tuple } from 'three';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';

/** Registers a concrete wheel component as its own `JoltVehicleWheelComponent`. */
export function provideJoltVehicleWheelComponent<T extends JoltVehicleWheelComponent>(
  component: Type<T>,
) {
  return [
    {
      provide: JoltVehicleWheelComponent,
      useExisting: forwardRef(() => component),
    },
  ];
}

/**
 * Declarative base for one virtual wheel of a `VehicleConstraint`. Concrete
 * subclasses build the exact `WheelSettings` flavor Jolt wants (tracked vs
 * wheeled) from these shared inputs. Each wheel maps 1:1 to an entry in the
 * vehicle's `mWheels` array; tracked vehicles additionally assign the wheel to
 * the left/right track via {@link track}.
 *
 * Wheels are created once when the parent `jolt-vehicle` builds the
 * constraint. Editing these inputs after the vehicle exists has no effect —
 * the constraint aliases its wheels array and is never rebuilt (see the
 * `VehicleConstraint` family in `physics-world` for the memory-safety stance).
 */
@Component({
  selector: 'joltVehicleWheel',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export abstract class JoltVehicleWheelComponent implements OnDestroy {
  readonly physicsService = inject(JoltPhysicsService);
  readonly injector = inject(Injector);

  /** Local position of the wheel's axis (or suspension point) under the vehicle body, meters. */
  readonly position = input<Vector3Tuple>([0, 0, 0]);
  /** Local direction the suspension ray probes the ground along. Default: down. */
  readonly suspensionDirection = input<Vector3Tuple>([0, -1, 0]);
  /** Suspension travel, meters: fully compressed → fully extended. */
  readonly suspensionMinLength = input(0);
  readonly suspensionMaxLength = input(0.5);
  /** Suspension spring pre-load, meters. */
  readonly suspensionPreloadLength = input(0);
  /** Suspension spring natural oscillation frequency, Hz. */
  readonly suspensionFrequency = input(2);
  /** Suspension spring damping ratio (0..1; 1 = critically damped). */
  readonly suspensionDamping = input(0.5);
  /** Wheel/track radius, meters. */
  readonly radius = input(0.3);
  /** Wheel/track width, meters. */
  readonly width = input(0.2);
  /** Track this wheel is assigned to (tracked vehicles only): 0 = left, 1 = right. */
  readonly track = input(0);

  abstract createSettings(jolt: typeof Jolt): Jolt.WheelSettings;

  /** Fills the settings shared by every wheel flavor (position, suspension, radius). */
  protected applyBaseSettings(wheels: Jolt.WheelSettings, jolt: typeof Jolt): void {
    wheels.mPosition = new jolt.Vec3(...this.position());
    wheels.mSuspensionDirection = new jolt.Vec3(...this.suspensionDirection());
    wheels.mRadius = this.radius();
    wheels.mWidth = this.width();
    wheels.mSuspensionMinLength = this.suspensionMinLength();
    wheels.mSuspensionMaxLength = this.suspensionMaxLength();
    wheels.mSuspensionPreloadLength = this.suspensionPreloadLength();

    const spring = wheels.mSuspensionSpring;
    spring.mMode = jolt.ESpringMode_FrequencyAndDamping;
    spring.mFrequency = this.suspensionFrequency();
    spring.mDamping = this.suspensionDamping();
  }

  ngOnDestroy(): void {
    // The constraint's wheels array aliases each settings instance; tear-down
    // ownership belongs to the owning jolt-vehicle (which never destroys them,
    // matching the VehicleConstraint family's documented memory-safety stance).
  }
}