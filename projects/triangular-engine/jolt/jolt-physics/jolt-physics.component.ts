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

  readonly metaDat$ = this.physicsService.metaDat$;
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

  #initPhysics(loadedJolt: any): IJoltMetadata {
    // Initialize Jolt
    const settings = new loadedJolt.JoltSettings();
    settings.mMaxWorkerThreads = 4; // Limit the number of worker threads to 3 (for a total of 4 threads working on the simulation). Note that this value will always be clamped against the number of CPUs in the system - 1.
    this.#setupCollisionFiltering(settings);
    const jolt = new loadedJolt.JoltInterface(settings);
    loadedJolt.destroy(settings);
    const physicsSystem = jolt.GetPhysicsSystem();
    const bodyInterface = physicsSystem.GetBodyInterface();

    const metadata: IJoltMetadata = {
      settings,
      jolt,
      Jolt: loadedJolt,
      physicsSystem,
      bodyInterface,
    };

    this.metaDat$.next(metadata);

    return metadata;
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
    const meta = this.physicsService.metaDat$.value;
    if (!meta) return;
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
