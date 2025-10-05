import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  input,
  model,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import RAPIER from '@dimforge/rapier3d-compat';
import { Subject } from 'rxjs';
import { Vector3Tuple } from 'three';
import { EngineService } from '../../../services/engine.service';
import { PhysicsService } from '../../../services/physics.service';

/**
 * Wraps your 3D scene components in a physics world.
 *
 * Initializes the Rapier physics engine and provides a simulation step on every frame.
 *
 * All physics-enabled components (like <rigidBody>, <collider>, etc.) inside this tag will interact with each other based on physics rules.
 */
@Component({
    selector: 'physics',
    imports: [CommonModule],
    templateUrl: './physics.component.html',
    styleUrl: './physics.component.css',
    providers: []
})
export class PhysicsComponent implements OnInit, OnDestroy {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  readonly engineService = inject(EngineService);
  readonly #destroyRef = inject(DestroyRef);
  //#endregion

  // Configuration inputs
  readonly gravity = input<Vector3Tuple>([0, -9.81, 0]);
  readonly debug = input<boolean>();
  readonly paused = input<boolean>();

  // Physics debug visualization
  readonly debugMesh = this.physicsService.debugMesh;

  // Physics world
  readonly world$ = this.physicsService.world$;

  // Physics events
  readonly beforeStep$ = this.physicsService.beforeStep$;
  readonly stepped$ = this.physicsService.stepped$;

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

  constructor() {
    // Watch for gravity changes
    this.#initOnGravityChange();

    // Watch for debug mode changes
    this.#initOnDebugChange();

    // Watch for paused state changes
    this.#initOnSimulatePhysicsChange();

    this.#initEngineTick();
  }

  #initOnSimulatePhysicsChange(): void {
    effect(() => {
      const isPaused = this.paused();
      this.physicsService.setSimulatePhysics(isPaused);
    });
  }

  #initOnGravityChange(): void {
    effect(() => {
      const gravity = this.gravity();
      this.updateGravity(gravity);
    });
  }

  #initOnDebugChange(): void {
    effect(
      () => {
        const debug = this.debug();
        this.physicsService.setDebugState(debug ?? false);
        // if (debug) {
        //   // Create debug mesh if it doesn't exist
        //   if (!this.debugMesh()) {
        //     this.physicsService.createDebugMesh();
        //   }
        // } else {
        //   this.debugMesh.set(undefined);
        // }
      },
      { allowSignalWrites: true },
    );
  }

  #initEngineTick(): void {
    // Set up the physics simulation loop
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((deltaTime) => {
        // Update physics simulation
        this.physicsService.update(deltaTime);

        // Sync mesh positions with physics bodies
        this.physicsService.syncMeshes();

        // Update debug visualization if enabled
        if (this.debugMesh()) {
          this.physicsService.syncDebugMeshes();
        }
      });
  }

  ngOnInit(): void {
    // Wait for the physics world to be initialized
    this.physicsService.worldPromise.then(() => {
      console.log('Physics world initialized');

      // Set initial gravity
      this.updateGravity(this.gravity());
    });
  }

  private updateGravity(gravity: Vector3Tuple): void {
    const world = this.world$.value;
    if (!world) return;

    const [x, y, z] = gravity;
    world.gravity = new RAPIER.Vector3(x, y, z);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.physicsService.dispose();
  }
}
