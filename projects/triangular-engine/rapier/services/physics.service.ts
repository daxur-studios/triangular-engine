import {
  effect,
  inject,
  Injectable,
  signal,
  WritableSignal,
} from '@angular/core';
import RAPIER, { Vector } from '@dimforge/rapier3d-compat';
import { BehaviorSubject, startWith, Subject, takeUntil } from 'rxjs';
import {
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Vector3,
} from 'three';

import { getRigidBodyUserData } from '../components';

import { EngineSettingsService, EngineService } from 'triangular-engine';

@Injectable()
export class PhysicsService {
  readonly worldPromise: Promise<RAPIER.World> = this.initRAPIER();
  //#region Injected Dependencies
  readonly engineService = inject(EngineService);
  readonly engineSettingsService = inject(EngineSettingsService);
  // #endregion
  public readonly onDestroy$ = new Subject<void>();
  public dispose() {
    this.onDestroy$.next();
    this.onDestroy$.complete();
  }

  readonly world$ = new BehaviorSubject<RAPIER.World | undefined>(undefined);
  private gravity: RAPIER.Vector3 = new RAPIER.Vector3(0, 0, 0); // new RAPIER.Vector3(0, -9.81, 0);

  readonly #physicsPaused$ = new BehaviorSubject<boolean>(false);
  public setSimulatePhysics(value: boolean | undefined) {
    this.#physicsPaused$.next(value ?? false);
  }
  public getSimulatePhysics() {
    return this.#physicsPaused$.value;
  }

  readonly meshToBodyMap = new Map<Mesh, RAPIER.RigidBody>();

  readonly #rigidBodiesWithId = new Map<
    string,
    WritableSignal<RAPIER.RigidBody | undefined>
  >();
  public getRigidBodyById(id: string) {
    let body = this.#rigidBodiesWithId.get(id);
    if (!body) {
      body = signal(undefined);
      this.#rigidBodiesWithId.set(id, body);
    }

    return body;
  }
  public setRigidBodyById(id: string, body: RAPIER.RigidBody) {
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

  debugRenderBuffers = new RAPIER.DebugRenderBuffers(
    new Float32Array(),
    new Float32Array(),
  );

  private debugMaterial: LineBasicMaterial | undefined;
  private debugGeometry: BufferGeometry | undefined;
  readonly debugMesh = signal<LineSegments | undefined>(undefined);

  /** Collision events drained after each world.step */
  readonly collisionEvents$ = new Subject<{
    h1: number;
    h2: number;
    started: boolean;
  }>();

  /** Contact force events drained after each world.step */
  readonly contactForceEvents$ = new Subject<{
    h1: number;
    h2: number;
    totalForceMagnitude: number;
    maxForceMagnitude: number;
    // The total force and max force direction can be useful for effects
    totalForce: Vector;
    maxForceDirection: Vector;
  }>();

  /** Internal Rapier event queue used for collision/trigger events */
  private eventQueue: RAPIER.EventQueue | undefined;

  constructor() {
    this.#syncDebugSettings();
    this.#syncPhysicsDebugMesh();
    this.#initEngineTick();
  }

  #initEngineTick() {
    this.engineService.tick$
      .pipe(takeUntil(this.onDestroy$))
      .subscribe((delta) => {
        this.update(delta);
        this.syncPhysicsToRender;
      });
  }
  private syncPhysicsToRender() {
    this.syncMeshes();
  }

  #syncPhysicsDebugMesh() {
    effect(() => {
      const debugMesh = this.debugMesh();
      if (debugMesh) {
        this.engineService.scene.add(debugMesh);
      }
    });
  }

  #createDebugMesh() {
    this.debugMaterial = new LineBasicMaterial({ vertexColors: true });
    this.debugGeometry = new BufferGeometry();
    this.debugMesh.set(
      new LineSegments(this.debugGeometry, this.debugMaterial),
    );
  }

  // Public method to create debug mesh
  public createDebugMesh() {
    this.#createDebugMesh();
  }

  private async initRAPIER() {
    // Load the Rapier WASM module
    await RAPIER.init();

    // Create the physics world
    const world = new RAPIER.World(this.gravity);
    this.world$.next(world);

    // Initialize event queue after Rapier is ready
    this.eventQueue = new RAPIER.EventQueue(true);

    return world;
  }

  readonly beforeStep$ = new Subject<number>();
  /**
   *  Triggered when the physics simulation steps. It's value is the current simulation timestep.
   * The simulation timestep governs by how much the physics state of the world will be integrated.
   */
  readonly stepped$ = new Subject<number>();

  /** Delta seconds */
  public update(deltaTime: number) {
    if (this.#physicsPaused$.value) return;

    this.beforeStep$.next(deltaTime);

    const world = this.world$.value;

    if (!world) return;

    world.timestep = deltaTime;
    // Step the physics simulation using the event queue so we can drain collision events
    if (this.eventQueue) {
      world.step(this.eventQueue);
      // Drain and emit collision events (started/ended)
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        this.collisionEvents$.next({ h1, h2, started });
      });
      // Drain and emit contact force events
      this.eventQueue.drainContactForceEvents((event) => {
        this.contactForceEvents$.next({
          h1: event.collider1(),
          h2: event.collider2(),
          totalForceMagnitude: event.totalForceMagnitude(),
          maxForceMagnitude: event.maxForceMagnitude(),
          totalForce: event.totalForce(),
          maxForceDirection: event.maxForceDirection(),
        });
      });
    } else {
      world.step();
    }

    this.stepped$.next(world.timestep);
  }

  public syncMeshes() {
    // Synchronize the Three.js meshes with the physics bodies
    this.meshToBodyMap.forEach((rigidBody, mesh) => {
      const position = rigidBody.translation();
      const rotation = rigidBody.rotation();

      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });

    if (this.engineSettingsService.settingsForm.value.debug) {
      this.syncDebugMeshes();
    }
  }

  public syncDebugMeshes() {
    if (!this.debugGeometry) return;

    const world = this.world$.value;
    if (!world) return;

    const debugMesh = this.debugMesh();
    if (!debugMesh) return;

    // Clear previous debug data
    // this.debugRenderBuffers.clear();

    // Generate debug data
    this.debugRenderBuffers = world.debugRender();

    // Update Three.js geometry with debug data
    this.updateDebugGeometry(
      this.debugRenderBuffers,
      this.debugGeometry,
      debugMesh,
    );
  }
  private updateDebugGeometry(
    debugBuffers: RAPIER.DebugRenderBuffers,
    geometry: BufferGeometry,
    debugMesh: LineSegments,
  ) {
    // Convert Rapier's Float32Array data to Three.js Float32BufferAttributes
    const positions = new Float32Array(debugBuffers.vertices.length);
    positions.set(debugBuffers.vertices);

    const colors = new Float32Array(debugBuffers.colors.length);
    colors.set(debugBuffers.colors);

    // Update geometry attributes
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 4));

    // Update the draw range
    geometry.setDrawRange(0, debugBuffers.vertices.length / 3);

    debugMesh.frustumCulled = false; // bug fix, but should be looked into

    this.#debugCustomForces();
  }

  customForceArrowHelpers: ArrowHelper[] = [];
  #debugCustomForces() {
    this.customForceArrowHelpers.forEach((arrowHelper) => {
      arrowHelper.removeFromParent();
      arrowHelper.dispose();
    });

    this.customForceArrowHelpers = [];

    const world = this.world$.value;
    if (!world) return;

    world.forEachActiveRigidBody((rigidBody) => {
      const userData = getRigidBodyUserData(rigidBody);
      if (!userData || !userData.customForcesToApply) return;

      const aaa: { force: Vector; point: Vector }[] = [];

      Object.values(userData.customForcesToApply)
        .filter((x) => !!x)
        .forEach((customForces) => {
          customForces.forEach((data) => {
            if ('point' in data && data.point) {
              aaa.push({ force: data.force, point: data.point });
            } else {
              aaa.push({ force: data.force, point: rigidBody.translation() });
            }
          });
        });

      aaa.forEach((data) => {
        const forceVector = new Vector3(
          data.force.x,
          data.force.y,
          data.force.z,
        );

        const forceArrowHelper = new ArrowHelper(
          forceVector,
          new Vector3(data.point.x, data.point.y, data.point.z),
          forceVector.length() * 100,
          'purple',
          10.6,
          10.3,
        );

        this.customForceArrowHelpers.push(forceArrowHelper);
      });
    });

    this.customForceArrowHelpers.forEach((arrowHelper) => {
      this.debugMesh()?.parent?.add(arrowHelper);
    });
  }

  getDebugState() {
    return this.engineSettingsService.settingsForm.value.debug ?? false;
  }
  setDebugState(state: boolean) {
    this.engineSettingsService.settingsForm.controls.debug.setValue(state);
  }
  #syncDebugSettings() {
    this.engineSettingsService.settingsForm.controls.debug.valueChanges
      .pipe(startWith(this.engineSettingsService.settingsForm.value.debug))
      .subscribe((debug) => {
        if (debug) {
          this.#createDebugMesh();
        } else {
          this.debugMesh()?.removeFromParent();
          this.debugMesh()?.clear();
          this.debugGeometry?.dispose();
          this.debugMaterial?.dispose();

          this.debugGeometry = undefined;
          this.debugMaterial = undefined;
          this.debugMesh.set(undefined);
        }
      });
  }

  // Remove a rigid body and its collider
  public removeRigidBody(mesh: Mesh) {
    const world = this.world$.value!;

    const rigidBody = this.meshToBodyMap.get(mesh);
    if (rigidBody) {
      world.removeRigidBody(rigidBody);
      this.meshToBodyMap.delete(mesh);
    }
  }

  public getRigidBodyByMesh(mesh: Mesh) {
    return this.meshToBodyMap.get(mesh);
  }
}
