import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  Type,
  WritableSignal,
} from '@angular/core';
import { Object3DComponent } from '../../object-3d';
import { RigidBodyComponent } from '../rigid-body/rigid-body.component';
import RAPIER, { Rotation } from '@dimforge/rapier3d-compat';
import { PhysicsService } from '../../../services';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuaternionTuple, Vector3Tuple } from 'three';

export interface ICollisionEvent {
  other: number;
  started: boolean;
}
export interface IContactForceEvent {
  other: number;
  totalForceMagnitude: number;
  maxForceMagnitude: number;
}

export function provideColliderComponent<T extends ColliderComponent>(
  colliderComponent: Type<T>,
) {
  return [{ provide: ColliderComponent, useValue: colliderComponent }];
}

@Component({
  selector: 'collider',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
})
export class ColliderComponent implements OnDestroy {
  //#region Injected Dependencies
  readonly physicsService = inject(PhysicsService);
  readonly object3DComponent = inject(Object3DComponent);
  readonly destroyRef = inject(DestroyRef);
  //#endregion
  readonly id = input<string | undefined>();

  readonly position = input<Vector3Tuple>([0, 0, 0]);
  readonly rotation = input<QuaternionTuple>();
  /** Console log the input message to test things are working */
  readonly debugEcho = input<string>();

  //#region Physical Properties
  readonly mass = input<number>();
  readonly friction = input<number>();
  readonly restitution = input<number>();
  readonly density = input<number>();
  /**
   * Rapier ActiveEvents bitflags value.
   *
   * - NONE = 0: No events enabled.
   * - COLLISION_EVENTS = 1: Enable collision events.
   * - CONTACT_FORCE_EVENTS = 2: Enable contact force events.
   *
   * You can combine these using bitwise OR, e.g. (COLLISION_EVENTS | CONTACT_FORCE_EVENTS).
   */
  readonly activeEvents = input<RAPIER.ActiveEvents>();
  /** Total force magnitude threshold to emit contact force events for this collider. */
  readonly contactForceEventThreshold = input<number>();
  //#endregion

  readonly colliderDesc = signal<RAPIER.ColliderDesc | undefined>(undefined);

  readonly collider = signal<RAPIER.Collider | undefined>(undefined);

  //#region Outputs
  /** Emits collision start/stop events involving this collider. */
  readonly collision = output<ICollisionEvent>();
  /** Emits contact force events involving this collider. */
  readonly contactForce = output<IContactForceEvent>();
  //#endregion

  constructor() {
    this.#initCollider();
    this.#initColliderPosition();
    this.#initColliderRotation();

    //#region Physical Properties
    this.#initMass();
    this.#initFriction();
    this.#initRestitution();
    this.#initDensity();
    this.#initActiveEvents();
    this.#initContactForceEventThreshold();
    //#endregion

    this.#initDebugEcho();
    this.#initEventForwarders();
  }

  #initDebugEcho() {
    effect(() => {
      const debugEcho = this.debugEcho();
      if (debugEcho) {
        console.log(debugEcho, this);
      }
    });
  }

  #initEventForwarders() {
    // Forward collision start/stop events filtered for this collider
    this.physicsService.collisionEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ h1, h2, started }) => {
        const self = this.collider();
        if (!self) return;
        const handle = self.handle;
        if (h1 === handle) this.collision.emit({ other: h2, started });
        else if (h2 === handle) this.collision.emit({ other: h1, started });
      });

    // Forward contact force events filtered for this collider
    this.physicsService.contactForceEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ h1, h2, totalForceMagnitude, maxForceMagnitude }) => {
        const self = this.collider();
        if (!self) return;
        const handle = self.handle;
        // Only forward the event if it passes this collider's own threshold.
        // This prevents events generated due to the other collider's lower threshold
        // from being forwarded here.
        const threshold = this.contactForceEventThreshold();
        const passesThreshold =
          threshold === undefined
            ? true
            : totalForceMagnitude >= threshold ||
              maxForceMagnitude >= threshold;

        if (!passesThreshold) return;

        if (h1 === handle)
          this.contactForce.emit({
            other: h2,
            totalForceMagnitude,
            maxForceMagnitude,
          });
        else if (h2 === handle)
          this.contactForce.emit({
            other: h1,
            totalForceMagnitude,
            maxForceMagnitude,
          });
      });
  }

  #initCollider() {
    effect(
      async () => {
        const parentRigidBodyComponent = this.#getParentAsRigidBodyComponent();
        if (!parentRigidBodyComponent) return;

        const colliderDesc = this.colliderDesc();

        if (!colliderDesc) return;

        const world = await this.physicsService.worldPromise;

        const rigidBody = parentRigidBodyComponent.rigidBody();

        const collider = world.createCollider(colliderDesc, rigidBody);

        this.collider.set(collider);
      },
      { allowSignalWrites: true },
    );
  }

  #initColliderPosition() {
    const translation = new RAPIER.Vector3(0, 0, 0);

    effect(() => {
      const collider = this.collider();
      if (!collider) return;

      const position = this.position();

      translation.x = position[0];
      translation.y = position[1];
      translation.z = position[2];

      collider.setTranslationWrtParent(translation);
    });
  }

  #initColliderRotation() {
    effect(() => {
      const collider = this.collider();
      const rotation = this.rotation();

      if (!collider || !rotation) return;

      const r: Rotation = {
        x: rotation[0],
        y: rotation[1],
        z: rotation[2],
        w: rotation[3],
      };

      collider.setRotationWrtParent(r);
    });
  }

  #getParentAsRigidBodyComponent() {
    if (this.object3DComponent instanceof RigidBodyComponent) {
      return this.object3DComponent;
    }
    return this.#findClosestRigidBodyComponent();
  }

  /**
   * Traverse upwards to find the closest rigid body component
   */
  #findClosestRigidBodyComponent() {
    let parent: RigidBodyComponent | Object3DComponent | null =
      this.object3DComponent;

    const maxDepth = 10;
    let depth = 0;

    while (parent) {
      if (parent instanceof RigidBodyComponent) {
        return parent;
      }
      parent = parent.parent;
      depth++;
      if (depth > maxDepth) {
        console.warn('Max depth reached, cannot find rigid body component');
        return null;
      }
    }
    return undefined;
  }

  //#region Physical Properties
  #initMass() {
    effect(() => {
      const mass = this.mass();
      const collider = this.collider();
      if (!collider || mass === undefined) return;

      collider.setMass(mass);
    });
  }

  #initFriction() {
    effect(() => {
      const friction = this.friction();
      const collider = this.collider();
      if (!collider || friction === undefined) return;

      collider.setFriction(friction);
    });
  }
  #initRestitution() {
    effect(() => {
      const restitution = this.restitution();
      const collider = this.collider();
      if (!collider || restitution === undefined) return;

      collider.setRestitution(restitution);
    });
  }
  #initDensity() {
    effect(() => {
      const density = this.density();
      const collider = this.collider();
      if (!collider || density === undefined) return;

      collider.setDensity(density);
    });
  }
  //#endregion

  #initActiveEvents() {
    // Apply to descriptor before creation if possible
    effect(() => {
      const activeEvents = this.activeEvents();
      const colliderDesc = this.colliderDesc();
      if (!colliderDesc || activeEvents === undefined) return;
      colliderDesc.setActiveEvents(activeEvents);
    });

    // Apply to collider after creation too (reactive updates)
    effect(() => {
      const activeEvents = this.activeEvents();
      const collider = this.collider();
      if (!collider || activeEvents === undefined) return;
      collider.setActiveEvents(activeEvents);
    });
  }

  #initContactForceEventThreshold() {
    // Apply to descriptor before creation if possible
    effect(() => {
      const threshold = this.contactForceEventThreshold();
      const colliderDesc = this.colliderDesc();
      if (!colliderDesc || threshold === undefined) return;
      colliderDesc.setContactForceEventThreshold(threshold);
    });

    // Apply to collider after creation too (reactive updates)
    effect(() => {
      const threshold = this.contactForceEventThreshold();
      const collider = this.collider();
      if (!collider || threshold === undefined) return;
      collider.setContactForceEventThreshold(threshold);
    });
  }

  ngOnDestroy(): void {
    const collider = this.collider();
    const world = this.physicsService.world$.value;

    if (collider && world) {
      world.removeCollider(collider, true);
    }
  }
}
