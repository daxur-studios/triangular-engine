import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  input,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhysicsService } from '../../../services/physics.service';
import { EngineService } from '../../../services/engine.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { PhysicsComponentsModule } from '../physics-components.module';
import { Vector3Tuple } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Wraps your 3D scene components in a physics world.
 *
 * Initializes the Rapier physics engine and provides a simulation step on every frame.
 *
 * All physics-enabled components (like <rigidBody>, <collider>, etc.) inside this tag will interact with each other based on physics rules.
 */
@Component({
  selector: 'physics',
  standalone: true,
  imports: [CommonModule, PhysicsComponentsModule],
  templateUrl: './physics.component.html',
  styleUrl: './physics.component.css',
})
export class PhysicsComponent implements OnInit, OnDestroy {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  readonly engineService = inject(EngineService);
  //#endregion

  // Configuration inputs
  readonly gravity = input<Vector3Tuple>([0, -9.81, 0]);
  readonly debug = input<boolean>(false);
  readonly paused = input<boolean>(false);

  // Physics debug visualization
  readonly debugMesh = this.physicsService.debugMesh;

  // Physics simulation state
  readonly simulatePhysics$ = this.physicsService.simulatePhysics$;

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
    effect(() => {
      const paused = this.paused();
      this.simulatePhysics$.next(!paused);
    });
  }

  #initOnGravityChange(): void {
    effect(() => {
      const gravity = this.gravity();
      this.updateGravity(gravity);
    });
  }

  #initOnDebugChange(): void {
    effect(() => {
      const debug = this.debug();
      if (debug) {
        // Create debug mesh if it doesn't exist
        if (!this.debugMesh()) {
          this.physicsService.createDebugMesh();
        }
      } else {
        this.debugMesh.set(undefined);
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

    // Set up the physics simulation loop
    this.engineService.tick$
      .pipe(takeUntilDestroyed())
      .subscribe((deltaTime: number) => {
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

  private updateGravity(gravity: Vector3Tuple): void {
    const world = this.world$.value;
    if (!world) return;

    const [x, y, z] = gravity;
    world.gravity = new RAPIER.Vector3(x, y, z);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
