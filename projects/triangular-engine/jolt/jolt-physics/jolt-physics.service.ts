import { Injectable, signal, WritableSignal } from '@angular/core';
import Jolt from 'jolt-physics/wasm-compat';
import { BehaviorSubject, filter, firstValueFrom, Subject } from 'rxjs';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';

export interface IJoltMetadata {
  settings: Jolt.JoltSettings;
  jolt: Jolt.JoltInterface;
  Jolt: typeof Jolt;
  physicsSystem: Jolt.PhysicsSystem;
  bodyInterface: Jolt.BodyInterface;
}

// Export the Jolt module - consumers should import this instead of 'jolt-physics/wasm-compat'
// After JoltPhysicsService.load() is called, this will be the initialized instance
// This fixes bugs where Jolt.Vec3 is undefined
export {
  /** IMPORTANT: USE THIS INSTEAD OF IMPORTING 'jolt-physics/wasm-compat' EVERYWHERE*/
  Jolt,
};

@Injectable()
export class JoltPhysicsService {
  static Jolt = Jolt;
  static async load() {
    const initializedJolt = await Jolt({
      // locateFile: (file: string) => `jolt/${file}`,
    });

    Object.assign(Jolt, initializedJolt);

    // Also set on window for global access
    (window as any).Jolt = Jolt;

    this.Jolt = Jolt;

    return initializedJolt;
  }

  readonly metaData$ = new BehaviorSubject<IJoltMetadata | undefined>(
    undefined,
  );
  readonly metaDataPromise = firstValueFrom(
    this.metaData$.pipe(filter(Boolean)),
  );

  /**
   * Updated/Paused by PhysicsComponent.
   *
   * Emits delta seconds
   *
   * This is the physics tick compared to the engine tick from EngineService
   */
  readonly tick$ = new Subject<number>();
  readonly postTick$ = new Subject<number>();

  readonly #rigidBodiesWithId = new Map<
    string,
    WritableSignal<Jolt.Body | undefined>
  >();
  public getRigidBodyById(id: string) {
    let body = this.#rigidBodiesWithId.get(id);
    if (!body) {
      body = signal(undefined);
      this.#rigidBodiesWithId.set(id, body);
    }

    return body;
  }
  public setRigidBodyById(id: string, body: Jolt.Body) {
    const prev = this.#rigidBodiesWithId.get(id);
    if (prev) {
      prev.set(body);
    } else {
      this.#rigidBodiesWithId.set(id, signal(body));
    }
  }
  /** Remove the rigid body from the map and clear the signal */
  public clearRigidBodyWithId(id: string) {
    const prev = this.#rigidBodiesWithId.get(id);
    if (prev) {
      prev.set(undefined);
    }
    this.#rigidBodiesWithId.delete(id);
  }

  /** Synced from PhysicsComponent, DO NOT MODIFY */
  readonly rigidBodyComponents$ = new BehaviorSubject<
    ReadonlyArray<JoltRigidBodyComponent>
  >([]);
  readonly bodies$ = new BehaviorSubject<Jolt.Body[]>([]);
  readonly constraints$ = new BehaviorSubject<IJoltConstraintData[]>([]);

  /** Maps Jolt User Data ID to rigid body component for activation listener */
  readonly userDataToComponent = new Map<number, JoltRigidBodyComponent>();

  constructor() {}

  registerBody(body: Jolt.Body, component: JoltRigidBodyComponent) {
    this.bodies$.next([...this.bodies$.value, body]);
    this.userDataToComponent.set(component.userDataId, component);
  }
  unregisterBody(body: Jolt.Body) {
    this.bodies$.next(this.bodies$.value.filter((b) => b !== body));
    this.userDataToComponent.delete(body.GetUserData());
  }

  registerConstraint(constraint: Jolt.Constraint, a: Jolt.Body, b: Jolt.Body) {
    const alreadyRegistered = this.constraints$.value.some(
      (c) => c.constraint === constraint,
    );
    if (alreadyRegistered) {
      console.warn('Constraint already registered');

      return;
    }

    this.constraints$.next([...this.constraints$.value, { a, b, constraint }]);
  }
  unregisterConstraint(constraint: Jolt.Constraint) {
    this.constraints$.next(
      this.constraints$.value.filter((c) => c.constraint !== constraint),
    );
  }
}

export interface IJoltConstraintData {
  a: Jolt.Body;
  b: Jolt.Body;
  constraint: Jolt.Constraint;
}
