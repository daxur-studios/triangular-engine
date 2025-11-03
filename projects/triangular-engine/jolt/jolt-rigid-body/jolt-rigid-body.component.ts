import {
  Component,
  computed,
  contentChildren,
  effect,
  forwardRef,
  inject,
  Injector,
  input,
  output,
  Provider,
  Type,
  untracked,
  viewChildren,
} from '@angular/core';
import {
  takeUntilDestroyed,
  toObservable,
  toSignal,
} from '@angular/core/rxjs-interop';

import { BehaviorSubject, combineLatest } from 'rxjs';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';
import { LAYER_MOVING, wrapQuat, wrapVec3 } from '../example';
import { JoltPhysicsComponent } from '../jolt-physics/jolt-physics.component';
import {
  IJoltMetadata,
  Jolt,
  JoltPhysicsService,
} from '../jolt-physics/jolt-physics.service';
import { JoltShapeComponent } from '../jolt-shapes/jolt-shape.component';
import { Euler, Quaternion, Vector3Tuple } from 'three';

/**
 * Provides both:
 * - JoltRigidBodyComponent
 * - Object3DComponent
 */
export function provideJoltRigidBodyComponent<T extends JoltRigidBodyComponent>(
  component: Type<T>,
): Provider[] {
  return [
    {
      provide: JoltRigidBodyComponent,
      useExisting: forwardRef(() => component),
    },
    provideObject3DComponent(component),
  ];
}

@Component({
  selector: 'jolt-rigid-body',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(JoltRigidBodyComponent)],
})
export class JoltRigidBodyComponent extends GroupComponent {
  static nextUserDataId = 1;
  /** This is added as the custom user data ID in Jolt `body.SetUserData(this.instanceId)` */
  readonly userDataId = JoltRigidBodyComponent.nextUserDataId++;
  //#region Services
  readonly physicsService = inject(JoltPhysicsService);
  readonly physicsComponent = inject(JoltPhysicsComponent);
  readonly injector = inject(Injector);
  //#endregion

  //#region Inputs
  readonly id = input<string>(); // TODO: finish this
  readonly id$ = toObservable(this.id);
  /**
   * type EMotionType = typeof EMotionType_Static | typeof EMotionType_Kinematic | typeof EMotionType_Dynamic;
   *
   * - EMotionType_Static: 0
   * - EMotionType_Kinematic: 1
   * - EMotionType_Dynamic: 2
   */
  readonly motionType = input<Jolt.EMotionType>();
  readonly motionType$ = toObservable(this.motionType);

  readonly velocity = input<Vector3Tuple>();
  readonly velocity$ = toObservable(this.velocity);

  // TODO: set up effects to update these when they change
  readonly angularDamping = input<number>();
  readonly linearDamping = input<number>();
  //#endregion

  //#region Outputs
  /** Emits whenever the body switches from active to asleep mode. Updated by JoltPhysicsComponent.OnBodyDeactivated */
  readonly onSleep = output<void>();
  /** Emits whenever the body switches from asleep to active mode. Updated by JoltPhysicsComponent.OnBodyActivated */
  readonly onActivate = output<void>();
  //#endregion

  readonly contentChildrenShapes = contentChildren(JoltShapeComponent, {
    descendants: true,
  });
  readonly viewChildrenShapes = viewChildren(JoltShapeComponent);
  readonly shapes = computed(() => {
    return [...this.contentChildrenShapes(), ...this.viewChildrenShapes()];
  });
  // readonly shapes = this.contentChildrenShapes;

  readonly shapes$ = toObservable(this.shapes);

  readonly body$ = new BehaviorSubject<Jolt.Body | undefined>(undefined);
  readonly body = toSignal(this.body$);

  constructor() {
    super();

    this.#registerInPhysicsService();

    this.#initAsync();
  }

  #registerInPhysicsService() {
    this.physicsService.rigidBodyComponents$.next([
      ...this.physicsService.rigidBodyComponents$.value,
      this,
    ]);
  }

  #disposeFromPhysicsService() {
    this.physicsService.rigidBodyComponents$.next(
      this.physicsService.rigidBodyComponents$.value.filter((r) => r !== this),
    );
  }

  async #initAsync() {
    const metadata = await this.physicsService.metaDataPromise;

    this.#initBodyCreation(metadata);
    this.#initTick(metadata);
    this.#initId();
    this.#initPosition(metadata);
    this.#initRotation(metadata);
    this.#initVelocity(metadata);
  }

  #initBodyCreation(metadata: IJoltMetadata) {
    effect(
      () => {
        const childShapeComponents = this.shapes();
        if (!childShapeComponents) return;
        const resolvedMotionType =
          this.motionType() ?? Jolt.EMotionType_Dynamic;

        const shapes: Jolt.Shape[] = childShapeComponents.map((component) =>
          component.shape(),
        );

        if (!shapes) return;

        const shapesList = Array.isArray(shapes) ? shapes : [shapes];
        const requiresStaticBody = shapesList.some((shape) => {
          const subType = shape?.GetSubType?.();
          return (
            subType === Jolt.EShapeSubType_Mesh ||
            subType === Jolt.EShapeSubType_HeightField
          );
        });

        if (
          requiresStaticBody &&
          resolvedMotionType !== Jolt.EMotionType_Static
        ) {
          console.error(
            'JoltRigidBody: Mesh and height field shapes are only supported on static bodies (motionType = 0). Received motion type:',
            resolvedMotionType,
          );
          return;
        }

        const initialPosition = this.position();

        // TODO: see if this can be simplified between single and compound shapes
        // Single shape
        if (Array.isArray(shapes) && shapes.length === 1 && shapes[0]) {
          const shape = shapes[0];
          // Replace existing body if any
          const existing = this.body$.value;
          if (existing) {
            try {
              this.physicsService.unregisterBody(existing);
              metadata.bodyInterface.RemoveBody(existing.GetID());
              metadata.bodyInterface.DestroyBody(existing.GetID());
            } catch {}
          }
          // Prepare creation settings with explicit temporary allocations that we destroy afterwards
          const bodyPosition = new Jolt.RVec3(
            initialPosition[0],
            initialPosition[1],
            initialPosition[2],
          );
          const settings: Jolt.BodyCreationSettings =
            new Jolt.BodyCreationSettings(
              shape,
              bodyPosition,
              Jolt.Quat.prototype.sIdentity(),
              resolvedMotionType,
              LAYER_MOVING,
              //   requiresStaticBody ? LAYER_NON_MOVING : LAYER_MOVING,
            );
          Jolt.destroy(bodyPosition);

          // Set angular and linear damping (default to 0 if not specified)
          // Use untracked() to read signal values without causing reactive subscriptions/effects to track them
          const angularDamping = untracked(() => this.angularDamping);
          const linearDamping = untracked(() => this.linearDamping);
          settings.mAngularDamping = angularDamping() ?? 0.0;
          settings.mLinearDamping = linearDamping() ?? 0.0;
          // Prefer continuous collision detection for fast movers
          settings.mMotionQuality = Jolt.EMotionQuality_LinearCast;

          const body = metadata.bodyInterface.CreateBody(settings);
          Jolt.destroy(settings);

          // Set the custom user data ID in Jolt
          body.SetUserData(this.userDataId);

          this.body$.next(body);
          this.physicsService.registerBody(body, this);

          metadata.bodyInterface.AddBody(
            body.GetID(),
            Jolt.EActivation_Activate,
          );

          const speedOfLight = 299_792_458; // ~3.0 × 10^8 m/s
          const cubeMP = body.GetMotionProperties();
          cubeMP.SetMaxLinearVelocity(speedOfLight);
          // Ensure CCD is applied at runtime too (required for active bodies)
          metadata.bodyInterface.SetMotionQuality(
            body.GetID(),
            Jolt.EMotionQuality_LinearCast,
          );
        }
        // Multiple shapes inside a compound shape
        else if (Array.isArray(shapes) && shapes.length > 1) {
          // Replace existing body if any
          const existing = this.body$.value;
          if (existing) {
            try {
              this.physicsService.unregisterBody(existing);
              metadata.bodyInterface.RemoveBody(existing.GetID());
              metadata.bodyInterface.DestroyBody(existing.GetID());
            } catch {}
          }

          // Create compound shape settings
          const compoundShapeSettings = new Jolt.StaticCompoundShapeSettings();

          // Add each shape with its local position and rotation
          for (const shapeComponent of childShapeComponents) {
            const shape = shapeComponent.shape();
            if (!shape) continue;

            // Get the shape component's local position and rotation relative to the rigid body
            const localPosition = shapeComponent.position?.() ?? [0, 0, 0];
            const localRotation = shapeComponent.rotation?.() ?? [0, 0, 0];

            // Convert Euler rotation to quaternion
            const q = new Quaternion().setFromEuler(
              new Euler(localRotation[0], localRotation[1], localRotation[2]),
            );
            const joltQuat = new Jolt.Quat(q.x, q.y, q.z, q.w);
            const joltPosition = new Jolt.Vec3(
              localPosition[0],
              localPosition[1],
              localPosition[2],
            );

            try {
              compoundShapeSettings.AddShapeShape(
                joltPosition,
                joltQuat,
                shape,
                0, // userData
              );
            } finally {
              Jolt.destroy(joltPosition);
              Jolt.destroy(joltQuat);
            }
          }

          const compoundShape = compoundShapeSettings.Create().Get();
          Jolt.destroy(compoundShapeSettings);

          // Create the body with the compound shape
          const bodyPosition = new Jolt.RVec3(
            initialPosition[0],
            initialPosition[1],
            initialPosition[2],
          );

          const settings: Jolt.BodyCreationSettings =
            new Jolt.BodyCreationSettings(
              compoundShape,
              bodyPosition,
              Jolt.Quat.prototype.sIdentity(),
              resolvedMotionType,
              LAYER_MOVING,
            );
          Jolt.destroy(bodyPosition);

          // Set angular and linear damping (default to 0 if not specified)
          const angularDamping = untracked(() => this.angularDamping);
          const linearDamping = untracked(() => this.linearDamping);
          settings.mAngularDamping = angularDamping() ?? 0.0;
          settings.mLinearDamping = linearDamping() ?? 0.0;
          // Prefer continuous collision detection for fast movers
          settings.mMotionQuality = Jolt.EMotionQuality_LinearCast;

          const body = metadata.bodyInterface.CreateBody(settings);
          Jolt.destroy(settings);

          // Set the custom user data ID in Jolt
          body.SetUserData(this.userDataId);

          this.body$.next(body);
          this.physicsService.registerBody(body, this);

          metadata.bodyInterface.AddBody(
            body.GetID(),
            Jolt.EActivation_Activate,
          );

          const speedOfLight = 299_792_458; // ~3.0 × 10^8 m/s
          const cubeMP = body.GetMotionProperties();
          cubeMP.SetMaxLinearVelocity(speedOfLight);
          // Ensure CCD is applied at runtime too (required for active bodies)
          metadata.bodyInterface.SetMotionQuality(
            body.GetID(),
            Jolt.EMotionQuality_LinearCast,
          );

          // Clean up the compound shape reference
          compoundShape.Release();
        }
      },
      { injector: this.injector },
    );
  }

  #initId() {
    combineLatest([this.id$, this.body$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([id, body]) => {
        if (id && body) {
          this.physicsService.setRigidBodyById(id, body);
        }
      });
  }

  #initPosition(metadata: IJoltMetadata) {
    effect(
      () => {
        const position = this.position();
        const body = this.body();

        if (!body) return;
        // Apply it through the BodyInterface (important!)
        const rpos = new Jolt.RVec3(position[0], position[1], position[2]);
        try {
          metadata.bodyInterface.SetPosition(
            body.GetID(),
            rpos,
            Jolt.EActivation_Activate,
          );
        } finally {
          Jolt.destroy(rpos);
        }
      },
      { injector: this.injector },
    );
  }

  #initRotation(metadata: IJoltMetadata) {
    effect(
      () => {
        const rotation = this.rotation();
        if (!rotation) return;
        const body = this.body();
        if (!body) return;

        const q = new Quaternion().setFromEuler(new Euler(...rotation));

        const rrot = new Jolt.Quat(...q.toArray());
        try {
          metadata.bodyInterface.SetRotation(
            body.GetID(),
            rrot,
            Jolt.EActivation_Activate,
          );
        } finally {
          Jolt.destroy(rrot);
        }
      },
      { injector: this.injector },
    );
  }

  #initVelocity(metadata: IJoltMetadata) {
    effect(
      () => {
        const velocity = this.velocity();
        if (!velocity) return;
        const body = this.body();
        if (!body) return;
        const rvel = new Jolt.Vec3(velocity[0], velocity[1], velocity[2]);
        try {
          metadata.bodyInterface.SetLinearVelocity(body.GetID(), rvel);
        } finally {
          Jolt.destroy(rvel);
        }
      },
      { injector: this.injector },
    );
  }

  dispose() {
    const body = this.body$.value;
    const metadata = this.physicsService.metaData$.value;

    if (!body) return;

    // Clear ID mapping FIRST - this triggers constraint components to dispose themselves
    const id = this.id();
    if (id) {
      this.physicsService.clearRigidBodyWithId(id);
    }

    // Set body to undefined to signal downstream that it's gone
    this.body$.next(undefined);

    // Unregister from tracking
    this.physicsService.unregisterBody(body);

    // Give constraint components a chance to dispose via their reactive subscriptions
    // This happens synchronously since signals update immediately

    // Remove and destroy the body from physics
    if (metadata) {
      try {
        const bodyId = body.GetID();
        metadata.bodyInterface.RemoveBody(bodyId);
        metadata.bodyInterface.DestroyBody(bodyId);
      } catch (error) {
        console.warn('Error destroying body:', error);
      }
    }
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.dispose();
    this.#disposeFromPhysicsService();
  }

  #initTick(metadata: IJoltMetadata) {
    this.physicsComponent.physicsUpdated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.#updateBodyTransform(metadata);
      });
  }

  #updateBodyTransform(metadata: IJoltMetadata) {
    const group = this.object3D();
    const body = this.body$.value;
    if (!body || !group) return;
    try {
      group.position.copy(wrapVec3(body.GetPosition()));
      group.quaternion.copy(wrapQuat(body.GetRotation()));
    } catch (error) {
      console.warn('Transform update failed (destroyed body):', error);
      // Clear reference
      this.body$.next(undefined);
      delete group.userData['body'];
    }
  }
}
