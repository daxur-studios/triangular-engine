import {
  Component,
  computed,
  contentChildren,
  DestroyRef,
  inject,
  input,
  OnDestroy,
  output,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { Vector3Tuple } from 'three';
import { LAYER_MOVING } from '../example';
import {
  IJoltMetadata,
  Jolt,
  JoltPhysicsService,
} from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import { JoltVehicleWheelComponent } from './jolt-vehicle-wheel.component';

/** Driver input vector applied to the vehicle controller every physics tick. */
export interface IVehicleDriverInput {
  /** Drive amount, roughly -1 (reverse) .. 0 (idle) .. 1 (full throttle). */
  readonly forward: number;
  /** Steering, -1 (hard left) .. 0 (straight) .. 1 (hard right). */
  readonly steer: number;
  /** Service brake amount 0..1. */
  readonly brake: number;
  /** Independent emergency/hand brake amount 0..1 (wheeled only). */
  readonly handBrake: number;
}

/** Emitted once the constraint exists, carrying the live constraint/controller. */
export interface IVehicleCreatedEvent {
  readonly constraint: Jolt.VehicleConstraint;
  readonly controller: Jolt.VehicleController;
  readonly wheelCount: number;
}

/**
 * Declarative VehicleConstraint host: binds one chassis rigid body and a set
 * of virtual wheel children into a Jolt `VehicleConstraint` (wheeled
 * `WheeledVehicleController` or tracked `TrackedVehicleController`, chosen by
 * the concrete subclass). The constraint is stepped by Jolt itself each
 * physics tick; this component pushes the {@link IVehicleDriverInput} into the
 * controller before every step so the vehicle actually responds to drive,
 * steer and brake input, and republishes each wheel's solved contact position
 * (chassis-local) for rendering.
 *
 * Lifecycle mirrors the known-safe `VehicleConstraint` stance: the constraint
 * is created once when both the chassis and wheels exist, and never rebuilt or
 * directly destroyed when it goes away — the physical constraint is removed
 * from the system, leaving native memory reclamation to the binding (see the
 * pinned `VehicleConstraint` note in physics-world).
 */
@Component({
  selector: 'joltVehicleConstraint',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export abstract class JoltVehicleConstraintComponent implements OnDestroy {
  readonly physicsService = inject(JoltPhysicsService);
  readonly destroyRef = inject(DestroyRef);

  /** Chassis body, as a component ref or the id of a `<joltRigidBody>`. */
  readonly chassis = input<JoltRigidBodyComponent | string>();
  /** Local up axis of the vehicle. */
  readonly up = input<Vector3Tuple>([0, 1, 0]);
  /** Local forward axis of the vehicle. */
  readonly forward = input<Vector3Tuple>([0, 0, 1]);
  /** Max pitch/roll angle in radians before the controller clamps the chassis. */
  readonly maxPitchRollAngle = input(0.3);

  /** Continuous driver input — the component applies it every physics tick. */
  readonly driver = input<IVehicleDriverInput>({
    forward: 0,
    steer: 0,
    brake: 0,
    handBrake: 0,
  });

  /** Fires once the VehicleConstraint exists and is registered in the world. */
  readonly created = output<IVehicleCreatedEvent>();

  /** Wheels declared inside this vehicle, in DOM order (wheel index mapping). */
  readonly wheels = contentChildren(JoltVehicleWheelComponent, {
    descendants: true,
  });
  readonly wheels$ = toObservable(this.wheels);

  readonly constraint$ = new BehaviorSubject<Jolt.VehicleConstraint | undefined>(
    undefined,
  );
  readonly controller$ = new BehaviorSubject<Jolt.VehicleController | undefined>(
    undefined,
  );
  readonly wheelCount$ = new BehaviorSubject(0);
  /** Solved foot contact per wheel, chassis-local, refreshed every physics tick. */
  readonly wheelContacts$ = new BehaviorSubject<Vector3Tuple[]>([]);

  #constraint: Jolt.VehicleConstraint | undefined;
  #controller: Jolt.VehicleController | undefined;
  #listener: Jolt.VehicleConstraintStepListener | undefined;
  #metadata: IJoltMetadata | undefined;

  /** Live Body signal for the chassis entry, re-resolved whenever it changes. */
  readonly #chassisBody = computed(() => this.#resolveChassisBody());

  constructor() {
    this.#initAsync();
  }

  async #initAsync() {
    const metadata = await this.physicsService.metaDataPromise;
    if (this.destroyRef.destroyed) return;
    this.#metadata = metadata;

    combineLatest([toObservable(this.#chassisBody), this.wheels$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const body = this.#chassisBody();
        const wheels = this.wheels();
        if (body && wheels.length > 0) {
          this.#buildIfNeeded(body, [...wheels]);
        }
      });

    this.physicsService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const controller = this.#controller;
        if (controller) {
          this.applyDriverInputToJolt(controller, this.driver());
        }
        this.#syncWheelContacts();
      });
  }

  /** Resolves the input chassis entry to its live Body, or undefined. */
  #resolveChassisBody(): Jolt.Body | undefined {
    const chassis = this.chassis();
    if (!chassis) return undefined;
    if (typeof chassis === 'string') {
      return this.physicsService.getRigidBodyById(chassis)();
    }
    return chassis.body();
  }

  #buildIfNeeded(body: Jolt.Body, wheels: JoltVehicleWheelComponent[]): void {
    if (this.#constraint) return;
    const metadata = this.#metadata!;
    const jolt = metadata.Jolt;

    try {
      const settings = new jolt.VehicleConstraintSettings();
      settings.mUp = new jolt.Vec3(...this.up());
      settings.mForward = new jolt.Vec3(...this.forward());
      settings.mMaxPitchRollAngle = this.maxPitchRollAngle();

      for (const wheel of wheels) {
        settings.mWheels.push_back(wheel.createSettings(jolt));
      }

      settings.mController = this.createControllerSettings(wheels);

      const constraint = new jolt.VehicleConstraint(body, settings);
      constraint.SetVehicleCollisionTester(
        new jolt.VehicleCollisionTesterRay(LAYER_MOVING),
      );
      this.#constraint = constraint;
      this.#controller = constraint.GetController();
      const listener = new jolt.VehicleConstraintStepListener(constraint);
      this.#listener = listener;

      metadata.physicsSystem.AddConstraint(constraint);
      metadata.physicsSystem.AddStepListener(listener);

      this.constraint$.next(constraint);
      this.controller$.next(this.#controller);
      this.wheelCount$.next(wheels.length);
      this.physicsService.registerVehicleConstraint(constraint, body);

      this.created.emit({
        constraint,
        controller: this.#controller,
        wheelCount: wheels.length,
      });
    } catch (error) {
      console.error('Failed to build vehicle constraint:', error);
    }
  }

  /** Publishes each wheel's solved foot contact, chassis-local, via the scalar
    * read (settings mPosition + suspension length along its direction) that the
    * pinned VehicleConstraint note endorses — never via the Mat44 wrapper. */
  #syncWheelContacts(): void {
    const constraint = this.#constraint;
    if (!constraint) return;
    const count = this.wheelCount$.value;
    const contacts: Vector3Tuple[] = [];
    let valid = true;
    for (let i = 0; i < count; ++i) {
      const wheel = constraint.GetWheel(i);
      const settings = wheel?.GetSettings();
      if (!settings) {
        valid = false;
        break;
      }
      const pos = settings.mPosition;
      const dir = settings.mSuspensionDirection;
      const length = wheel.GetSuspensionLength();
      const x = pos.GetX() + dir.GetX() * length;
      const y = pos.GetY() + dir.GetY() * length;
      const z = pos.GetZ() + dir.GetZ() * length;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        valid = false;
        break;
      }
      contacts.push([x, y, z]);
    }
    if (valid && contacts.length === count) {
      this.wheelContacts$.next(contacts);
    }
  }

  /**
   * Builds the controller settings the concrete vehicle wants and wires wheel
   * assignments (tracks for tracked, differentials for wheeled). Must return
   * settings that get assigned to the constraint's `mController`.
   */
  protected abstract createControllerSettings(
    wheels: JoltVehicleWheelComponent[],
  ): Jolt.VehicleControllerSettings;

  /** Concrete subclass maps a driver input onto its controller's setters. */
  protected abstract applyDriverInputToJolt(
    controller: Jolt.VehicleController,
    driver: IVehicleDriverInput,
  ): void;

  ngOnDestroy(): void {
    const metadata = this.#metadata;
    if (metadata) {
      if (this.#listener) {
        metadata.physicsSystem.RemoveStepListener(this.#listener);
        this.#listener = undefined;
      }
      if (this.#constraint) {
        metadata.physicsSystem.RemoveConstraint(this.#constraint);
        this.physicsService.unregisterConstraint(this.#constraint);
      }
    }
    // Do not Jolt.destroy the constraint/settings once removed; the binding
    // never relinquishes the wheel-settings array it aliases (the VehicleConstraint
    // memory-safety stance), so tearing the native objects down is a leak trap.
    this.#constraint = undefined;
    this.#controller = undefined;
    this.constraint$.next(undefined);
    this.controller$.next(undefined);
    this.wheelCount$.next(0);
    this.wheelContacts$.next([]);
  }
}