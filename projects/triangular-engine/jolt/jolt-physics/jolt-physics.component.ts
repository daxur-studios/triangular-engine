import { AsyncPipe } from '@angular/common';
import { Component, DestroyRef, inject, Injector, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { Mesh, Vector3Tuple } from 'three';
import { EngineService } from 'triangular-engine';
import {
  LAYER_MOVING,
  LAYER_NON_MOVING,
  NUM_OBJECT_LAYERS,
  wrapQuat,
  wrapVec3,
} from '../example';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';
import {
  IJoltMetadata,
  Jolt,
  JoltPhysicsService,
} from './jolt-physics.service';
import { JoltDebugRendererComponent } from '../jolt-debug-renderer/jolt-debug-renderer.component';
import {
  IContactValidateEvent,
  IContactAddedEvent,
  IContactPersistedEvent,
  IContactRemovedEvent,
  JoltEventEmitter,
} from '../models/contact-events.model';
@Component({
  selector: 'jolt-physics',
  imports: [AsyncPipe, JoltDebugRendererComponent],
  templateUrl: './jolt-physics.component.html',
  styleUrl: './jolt-physics.component.scss',
  providers: [
    {
      provide: JoltPhysicsService,
      useFactory: () => {
        // prefer parent instance if it exists
        const parent = inject(JoltPhysicsService, {
          skipSelf: true,
          optional: true,
        });
        console.log('parent???', parent);
        return parent ?? new JoltPhysicsService();
      },
    },
  ],
})
export class JoltPhysicsComponent {
  readonly engineService = inject(EngineService);
  readonly destroyRef = inject(DestroyRef);
  readonly physicsService = inject(JoltPhysicsService);

  //#region Inputs
  readonly paused = input<boolean>();
  readonly paused$ = toObservable(this.paused);

  readonly gravity = input<Vector3Tuple>();
  readonly gravity$ = toObservable(this.gravity);

  readonly debug = input<boolean>();
  readonly debug$ = toObservable(this.debug);
  //#endregion

  //#region View Children

  readonly rigidBodyComponents$ = new BehaviorSubject<JoltRigidBodyComponent[]>(
    [],
  );
  //#endregion

  readonly metaData$ = this.physicsService.metaData$;
  readonly metaDataPromise = this.physicsService.metaDataPromise;

  readonly dynamicObjects: Mesh[] = [];
  readonly physicsUpdated$ = new Subject<void>();
  #memoryLogInterval: any;
  // Fixed-timestep accumulator for stable physics stepping across time scaling
  #accumulator = 0;
  #fixedSubstep = 1.0 / 240.0; // ~240 Hz physics
  #maxStepsPerFrame = 300; // safety to avoid spiral of death

  constructor() {
    this.#init();
    this.#initSyncRigidBodyComponents();
  }
  #init() {
    const metadata = this.#initPhysics(Jolt);
    this.#initGravity(metadata);
    this.#initPhysicsTick(metadata);

    // Periodic memory logging
    const freeStart = Jolt.JoltInterface.prototype.sGetFreeMemory();
    this.#memoryLogInterval = setInterval(() => {
      try {
        const freeNow = Jolt.JoltInterface.prototype.sGetFreeMemory();
        const leaked = freeStart - freeNow;
        // eslint-disable-next-line no-console
        console.debug(
          '[Jolt] free(bytes):',
          freeNow,
          'leaked:+',
          leaked,
          'bodies:',
          this.physicsService.bodies$.value.length,
          'constraints:',
          this.physicsService.constraints$.value.length,
        );
      } catch {}
    }, 10000);
  }

  readonly activationListener = new Jolt.BodyActivationListenerJS();
  readonly contactListener = new Jolt.ContactListenerJS();

  #initPhysics(loadedJolt: typeof Jolt): IJoltMetadata {
    // Initialize Jolt
    const settings = new loadedJolt.JoltSettings();
    settings.mMaxWorkerThreads = 4; // Limit the number of worker threads to 3 (for a total of 4 threads working on the simulation). Note that this value will always be clamped against the number of CPUs in the system - 1.
    this.#setupCollisionFiltering(settings);
    const jolt = new loadedJolt.JoltInterface(settings);
    loadedJolt.destroy(settings);
    const physicsSystem = jolt.GetPhysicsSystem();
    const bodyInterface = physicsSystem.GetBodyInterface();

    // Create and register body activation listener
    const activationListener = this.activationListener;
    activationListener.OnBodyActivated = (
      inBodyID: number,
      inBodyUserData: number,
    ) => {
      this.OnBodyActivated(inBodyID, inBodyUserData);
    };
    activationListener.OnBodyDeactivated = (
      inBodyID: number,
      inBodyUserData: number,
    ) => {
      this.OnBodyDeactivated(inBodyID, inBodyUserData);
    };

    physicsSystem.SetBodyActivationListener(activationListener);

    // Create and register contact listener
    const contactListener = this.contactListener;
    contactListener.OnContactValidate = (
      body1: number,
      body2: number,
      baseOffset: number,
      collideShapeResult: number,
    ) => {
      return this.OnContactValidate(
        body1,
        body2,
        baseOffset,
        collideShapeResult,
      );
    };
    contactListener.OnContactAdded = (
      body1: number,
      body2: number,
      manifold: number,
      settings: number,
    ) => {
      this.OnContactAdded(body1, body2, manifold, settings);
    };
    contactListener.OnContactPersisted = (
      body1: number,
      body2: number,
      manifold: number,
      settings: number,
    ) => {
      this.OnContactPersisted(body1, body2, manifold, settings);
    };
    contactListener.OnContactRemoved = (subShapePair: number) => {
      this.OnContactRemoved(subShapePair);
    };

    physicsSystem.SetContactListener(contactListener);

    const metadata: IJoltMetadata = {
      settings,
      jolt,
      Jolt: loadedJolt,
      physicsSystem,
      bodyInterface,
    };

    this.metaData$.next(metadata);

    return metadata;
  }

  private OnBodyActivated(inBodyID: number, inBodyUserData: number): void {
    const decodedUserData = this.decodeUserData(inBodyUserData);
    const component =
      this.physicsService.userDataToComponent.get(decodedUserData);

    if (component) {
      component.onActivate.emit();
    }
  }

  private OnBodyDeactivated(inBodyID: number, inBodyUserData: number): void {
    const decodedUserData = this.decodeUserData(inBodyUserData);
    const component =
      this.physicsService.userDataToComponent.get(decodedUserData);

    if (component) {
      component.onSleep.emit();
    }
  }

  // Check if an emitter has subscribers without importing its specific type
  #hasSubscribers(emitter: JoltEventEmitter<any> | undefined): boolean {
    return !!emitter && !!emitter.hasSubscribers;
  }

  // Resolve component for a body using UserData first, then fall back to BodyID mapping
  #getComponentForBody(body: Jolt.Body) {
    try {
      const userData = this.decodeUserData(body.GetUserData());
      const comp = this.physicsService.userDataToComponent.get(userData);
      if (comp) return comp;
    } catch {}
    try {
      const id = body.GetID().GetIndexAndSequenceNumber();
      const comp = this.physicsService.bodyIdToComponent.get(id);
      if (comp) return comp;
    } catch {}
    return undefined;
  }

  private OnContactValidate(
    body1Ptr: number,
    body2Ptr: number,
    baseOffset: number,
    collideShapeResult: number,
  ): number {
    const body1 = Jolt.wrapPointer(body1Ptr, Jolt.Body);
    const body2 = Jolt.wrapPointer(body2Ptr, Jolt.Body);

    const component1 = this.#getComponentForBody(body1);
    const component2 = this.#getComponentForBody(body2);

    const needs1 = this.#hasSubscribers(component1?.onContactValidate);
    const needs2 = this.#hasSubscribers(component2?.onContactValidate);
    if (!needs1 && !needs2) {
      return Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
    }

    const collideShapeResultWrapped = Jolt.wrapPointer(
      collideShapeResult,
      Jolt.CollideShapeResult,
    );

    if (needs1) {
      const event: IContactValidateEvent = {
        otherBody: body2,
        baseOffset,
        collideShapeResult: collideShapeResultWrapped,
      };
      component1!.onContactValidate.emit(event);
    }
    if (needs2) {
      const event: IContactValidateEvent = {
        otherBody: body1,
        baseOffset,
        collideShapeResult: collideShapeResultWrapped,
      };
      component2!.onContactValidate.emit(event);
    }

    return Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
  }

  private OnContactAdded(
    body1Ptr: number,
    body2Ptr: number,
    manifold: number,
    settings: number,
  ): void {
    const body1 = Jolt.wrapPointer(body1Ptr, Jolt.Body);
    const body2 = Jolt.wrapPointer(body2Ptr, Jolt.Body);

    const component1 = this.#getComponentForBody(body1);
    const component2 = this.#getComponentForBody(body2);

    const needs1 = this.#hasSubscribers(component1?.onContactAdded);
    const needs2 = this.#hasSubscribers(component2?.onContactAdded);
    if (!needs1 && !needs2) return;

    const manifoldWrapped = Jolt.wrapPointer(manifold, Jolt.ContactManifold);
    const settingsWrapped = Jolt.wrapPointer(settings, Jolt.ContactSettings);

    if (needs1) {
      const event: IContactAddedEvent = {
        otherBody: body2,
        manifold: manifoldWrapped,
        settings: settingsWrapped,
      };
      component1!.onContactAdded.emit(event);
    }
    if (needs2) {
      const event: IContactAddedEvent = {
        otherBody: body1,
        manifold: manifoldWrapped,
        settings: settingsWrapped,
      };
      component2!.onContactAdded.emit(event);
    }
  }

  private OnContactPersisted(
    body1Ptr: number,
    body2Ptr: number,
    manifold: number,
    settings: number,
  ): void {
    const body1 = Jolt.wrapPointer(body1Ptr, Jolt.Body);
    const body2 = Jolt.wrapPointer(body2Ptr, Jolt.Body);

    const component1 = this.#getComponentForBody(body1);
    const component2 = this.#getComponentForBody(body2);

    const needs1 = this.#hasSubscribers(component1?.onContactPersisted);
    const needs2 = this.#hasSubscribers(component2?.onContactPersisted);
    if (!needs1 && !needs2) return;

    const manifoldWrapped = Jolt.wrapPointer(manifold, Jolt.ContactManifold);
    const settingsWrapped = Jolt.wrapPointer(settings, Jolt.ContactSettings);

    if (needs1) {
      const event: IContactPersistedEvent = {
        otherBody: body2,
        manifold: manifoldWrapped,
        settings: settingsWrapped,
      };
      component1!.onContactPersisted.emit(event);
    }
    if (needs2) {
      const event: IContactPersistedEvent = {
        otherBody: body1,
        manifold: manifoldWrapped,
        settings: settingsWrapped,
      };
      component2!.onContactPersisted.emit(event);
    }
  }

  private OnContactRemoved(subShapePair: number): void {
    const subShapePairWrapped = Jolt.wrapPointer(
      subShapePair,
      Jolt.SubShapeIDPair,
    );

    const body1ID = subShapePairWrapped.GetBody1ID();
    const body2ID = subShapePairWrapped.GetBody2ID();

    // Early exit if neither body cares about removal events
    const c1 = this.physicsService.bodyIdToComponent.get(
      body1ID.GetIndexAndSequenceNumber(),
    );
    const c2 = this.physicsService.bodyIdToComponent.get(
      body2ID.GetIndexAndSequenceNumber(),
    );

    const needs1 = this.#hasSubscribers(c1?.onContactRemoved);
    const needs2 = this.#hasSubscribers(c2?.onContactRemoved);
    if (!needs1 && !needs2) return;

    // Find the bodies by iterating through registered bodies only when needed
    const bodies = this.physicsService.bodies$.value;
    const body1 = bodies.find(
      (body) =>
        body.GetID().GetIndexAndSequenceNumber() ===
        body1ID.GetIndexAndSequenceNumber(),
    );
    const body2 = bodies.find(
      (body) =>
        body.GetID().GetIndexAndSequenceNumber() ===
        body2ID.GetIndexAndSequenceNumber(),
    );

    if (!body1 || !body2) return;

    if (needs1) {
      const event: IContactRemovedEvent = {
        subShapePair: subShapePairWrapped,
        otherBody: body2,
      };
      c1!.onContactRemoved.emit(event);
    }
    if (needs2) {
      const event: IContactRemovedEvent = {
        subShapePair: subShapePairWrapped,
        otherBody: body1,
      };
      c2!.onContactRemoved.emit(event);
    }
  }
  /**
   * Fix when user data comes back as a weird number, eg in Jolt.BodyActivationListenerJS.OnBodyActivated and OnBodyDeactivated.
   *
   * Nothing is “breaking” your IDs—your wrapper is just reinterpreting the 64-bit integer bits as a float64 when it calls you back.
   * So 1 → 5e-324, 2 → 1e-323, etc.
   * That’ll always look weird if you read it directly.
   */
  decodeUserData(raw: number): number {
    const ab = new ArrayBuffer(8);
    const f64 = new Float64Array(ab);
    const u32 = new Uint32Array(ab);
    f64[0] = raw; // same 64 bits you received
    const low = u32[0] >>> 0;
    const high = u32[1] >>> 0;
    return low + high * 2 ** 32; // exact up to 2^53-1
  }

  #initGravity(metadata: IJoltMetadata) {
    this.gravity$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((gravity) => {
        if (!gravity) return;
        const Jolt = metadata.Jolt;
        const g = new Jolt.Vec3(gravity[0], gravity[1], gravity[2]);
        try {
          metadata.physicsSystem.SetGravity(g);
        } finally {
          Jolt.destroy(g);
        }
      });
  }

  #setupCollisionFiltering(settings: any) {
    const Jolt = (window as any).Jolt;
    if (!Jolt) {
      throw new Error('Jolt not initialized');
    }

    // Layer that objects can be in, determines which other objects it can collide with
    // Typically you at least want to have 1 layer for moving bodies and 1 layer for static bodies, but you can have more
    // layers if you want. E.g. you could have a layer for high detail collision (which is not used by the physics simulation
    // but only if you do collision testing).
    let objectFilter = new Jolt.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS);
    objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
    objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

    // Each broadphase layer results in a separate bounding volume tree in the broad phase. You at least want to have
    // a layer for non-moving and moving objects to avoid having to update a tree full of static objects every frame.
    // You can have a 1-on-1 mapping between object layers and broadphase layers (like in this case) but if you have
    // many object layers you'll be creating many broad phase trees, which is not efficient.
    const BP_LAYER_NON_MOVING = new Jolt.BroadPhaseLayer(0);
    const BP_LAYER_MOVING = new Jolt.BroadPhaseLayer(1);
    const NUM_BROAD_PHASE_LAYERS = 2;
    let bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(
      NUM_OBJECT_LAYERS,
      NUM_BROAD_PHASE_LAYERS,
    );
    bpInterface.MapObjectToBroadPhaseLayer(
      LAYER_NON_MOVING,
      BP_LAYER_NON_MOVING,
    );
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_LAYER_MOVING);

    // Layers copied into bpInterface
    Jolt.destroy(BP_LAYER_NON_MOVING);
    Jolt.destroy(BP_LAYER_MOVING);

    settings.mObjectLayerPairFilter = objectFilter;
    settings.mBroadPhaseLayerInterface = bpInterface;
    settings.mObjectVsBroadPhaseLayerFilter =
      new Jolt.ObjectVsBroadPhaseLayerFilterTable(
        settings.mBroadPhaseLayerInterface,
        NUM_BROAD_PHASE_LAYERS,
        settings.mObjectLayerPairFilter,
        NUM_OBJECT_LAYERS,
      );
  }

  #initPhysicsTick(metadata: IJoltMetadata) {
    combineLatest([this.engineService.tick$, this.paused$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([deltaSeconds, paused]) => {
        if (paused) return;
        this.#renderExampleTick(deltaSeconds, metadata);
      });
  }

  #renderExampleTick(deltaTime: number, metadata: IJoltMetadata) {
    // Accumulate scaled time and advance physics in fixed substeps
    this.#accumulator += deltaTime;
    let steps = 0;
    while (
      this.#accumulator >= this.#fixedSubstep &&
      steps < this.#maxStepsPerFrame
    ) {
      this.#updatePhysics(this.#fixedSubstep, metadata);
      this.#accumulator -= this.#fixedSubstep;
      steps++;
    }
    // Prevent unbounded buildup if frame rate tanks
    const maxBacklog = this.#fixedSubstep * this.#maxStepsPerFrame;
    if (this.#accumulator > maxBacklog) this.#accumulator = maxBacklog;

    // Now update object transforms from the latest physics state
    for (let i = 0, il = this.dynamicObjects.length; i < il; i++) {
      const objThree = this.dynamicObjects[i];
      const body = objThree.userData['body'];
      if (!body) {
        // Stale entry; clean up
        this.dynamicObjects.splice(i, 1);
        i--;
        il--;
        continue;
      }
      try {
        objThree.position.copy(wrapVec3(body.GetPosition()));
        objThree.quaternion.copy(wrapQuat(body.GetRotation()));
      } catch (error) {
        console.warn('Skipping update for potentially destroyed body:', error);
        // Clear reference and remove from array
        delete objThree.userData['body'];
        this.dynamicObjects.splice(i, 1);
        i--;
        il--;
      }
    }

    // Signal that physics + transforms are updated
    this.physicsUpdated$.next();
  }

  #updatePhysics(deltaTime: number, metadata: IJoltMetadata) {
    // Substep and recompute external forces each substep for stability in strong fields
    const targetSubstep = 1.0 / 240.0; // ~240 Hz substeps
    const numSteps = Math.max(1, Math.ceil(deltaTime / targetSubstep));
    const subDt = deltaTime / numSteps;
    for (let i = 0; i < numSteps; i++) {
      // Allow systems to apply forces based on the current state before each substep
      this.physicsService.tick$.next(subDt);
      metadata.jolt.Step(subDt, 1);
    }
    this.physicsService.postTick$.next(subDt);
  }

  #initSyncRigidBodyComponents() {
    this.rigidBodyComponents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rigidBodyComponents) => {
        this.physicsService.rigidBodyComponents$.next(rigidBodyComponents);
      });
  }
  #disposeSyncRigidBodyComponents() {
    this.physicsService.rigidBodyComponents$.next([]);
  }

  ngOnDestroy(): void {
    this.#disposeSyncRigidBodyComponents();
    const meta = this.physicsService.metaData$.value;
    if (!meta) return;

    // Release the activation listener
    try {
      Jolt.destroy(this.activationListener);
    } catch {
      console.warn('Failed to destroy activation listener');
    }

    // Release the contact listener
    try {
      Jolt.destroy(this.contactListener);
    } catch {
      console.warn('Failed to destroy contact listener');
    }

    if (this.#memoryLogInterval) {
      clearInterval(this.#memoryLogInterval);
      this.#memoryLogInterval = undefined;
    }
    try {
      // Clear all dynamicObjects references first to prevent ticks from accessing them
      for (const obj of this.dynamicObjects) {
        delete obj.userData['body'];
      }
      this.dynamicObjects.length = 0; // Empty the array aggressively

      // Remove any remaining constraints and bodies tracked in the service
      for (const { a, b, constraint } of this.physicsService.constraints$
        .value) {
        try {
          meta.physicsSystem.RemoveConstraint(constraint);
        } catch {}
      }
      this.physicsService.constraints$.next([]);

      for (const body of this.physicsService.bodies$.value) {
        try {
          meta.bodyInterface.RemoveBody(body.GetID());
          meta.bodyInterface.DestroyBody(body.GetID());
        } catch {}
      }
      this.physicsService.bodies$.next([]);
    } finally {
      try {
        const Jolt = meta.Jolt;
        Jolt.destroy(meta.jolt);
      } catch {}
    }
  }
}
