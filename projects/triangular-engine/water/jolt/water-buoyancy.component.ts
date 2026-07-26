import { Component, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Vector3 } from 'three';
import { EngineService, Object3DComponent } from 'triangular-engine';
import {
  Jolt,
  JoltPhysicsService,
  JoltRigidBodyComponent,
  wrapVec3,
} from 'triangular-engine/jolt';
import { WaterService } from 'triangular-engine/water';
import {
  DEFAULT_WATER_BUOYANCY_SETTINGS,
  resolveWaterBuoyancyImpulseInput,
} from './water-buoyancy';

/**
 * Attaches to a parent `<jolt-rigid-body>` (same upward-DI pattern as the
 * `jolt-*-shape` components) and, once per physics substep before `Step()`,
 * samples the registered `WaterSurface` at the body's position and applies
 * `Jolt.Body#ApplyBuoyancyImpulse` — see
 * docs/runbook/002_water_sublibrary.md, "Jolt buoyancy".
 *
 * Detection is a single tangent-plane probe at the body's own position, not
 * a sensor volume — matches the runbook's stated design (waves, bounded
 * lakes and rivers need surface sampling, not fixed boxed volumes). Long
 * hulls spanning multiple wave crests are a known follow-up (`probePoints`,
 * unbuilt) — this is a single-probe implementation.
 */
@Component({
  selector: 'waterBuoyancy',
  template: '',
})
export class WaterBuoyancyComponent {
  private readonly parentComponent = inject(Object3DComponent);
  private readonly engine = inject(EngineService);
  private readonly water = inject(WaterService);
  private readonly physicsService = inject(JoltPhysicsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly buoyancy = input(DEFAULT_WATER_BUOYANCY_SETTINGS.buoyancy);
  readonly linearDrag = input(DEFAULT_WATER_BUOYANCY_SETTINGS.linearDrag);
  readonly angularDrag = input(DEFAULT_WATER_BUOYANCY_SETTINGS.angularDrag);

  /** Fires once when the tracked body's position crosses below the surface. */
  readonly onEnterWater = output<void>();
  /** Fires once when the tracked body's position crosses back above the surface. */
  readonly onExitWater = output<void>();

  private readonly rigidBodyComponent = this.#findClosestRigidBodyComponent();
  private readonly trackedPosition = new Vector3();

  constructor() {
    if (!this.rigidBodyComponent) {
      console.error(
        '<waterBuoyancy> must be nested inside a <jolt-rigid-body>.',
      );
      return;
    }
    const rigidBodyComponent = this.rigidBodyComponent;

    // Render-rate enter/leave events, reusing WaterService's own event
    // vocabulary (same stream `track()` gives every other consumer) rather
    // than inventing a parallel one.
    const tracker = this.water.track(() => {
      const body = rigidBodyComponent.body$.value;
      return body
        ? this.trackedPosition.copy(wrapVec3(body.GetPosition()))
        : this.trackedPosition;
    });
    tracker.crossings$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.type === 'enter') this.onEnterWater.emit();
        else this.onExitWater.emit();
      });
    this.destroyRef.onDestroy(() => tracker.dispose());

    // Physics-rate buoyancy impulse: one sample + one impulse per substep,
    // ahead of `Step()`, mirroring the engine's own force-request timing.
    this.physicsService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaTime) => this.#applyBuoyancy(rigidBodyComponent, deltaTime));
  }

  #applyBuoyancy(
    rigidBodyComponent: JoltRigidBodyComponent,
    deltaTime: number,
  ): void {
    const body = rigidBodyComponent.body$.value;
    if (!body) return;
    if (body.GetMotionType() !== Jolt.EMotionType_Dynamic) return;

    const metadata = this.physicsService.metaData$.value;
    if (!metadata) return;

    const position = wrapVec3(body.GetPosition());
    const elapsedSeconds = this.engine.timer.getElapsed();
    const sample = this.water.sample(position, elapsedSeconds);
    if (!sample) return;

    const gravity = wrapVec3(metadata.physicsSystem.GetGravity());
    const resolved = resolveWaterBuoyancyImpulseInput(
      sample,
      [gravity.x, gravity.y, gravity.z],
      deltaTime,
      {
        buoyancy: this.buoyancy(),
        linearDrag: this.linearDrag(),
        angularDrag: this.angularDrag(),
      },
    );

    const surfacePosition = new Jolt.RVec3(...resolved.surfacePosition);
    const surfaceNormal = new Jolt.Vec3(...resolved.surfaceNormal);
    const fluidVelocity = new Jolt.Vec3(...resolved.fluidVelocity);
    const gravityVec = new Jolt.Vec3(...resolved.gravity);
    try {
      const entered = body.ApplyBuoyancyImpulse(
        surfacePosition,
        surfaceNormal,
        resolved.buoyancy,
        resolved.linearDrag,
        resolved.angularDrag,
        fluidVelocity,
        gravityVec,
        resolved.deltaTime,
      );
      if (entered) {
        metadata.bodyInterface.ActivateBody(body.GetID());
      }
    } finally {
      Jolt.destroy(surfacePosition);
      Jolt.destroy(surfaceNormal);
      Jolt.destroy(fluidVelocity);
      Jolt.destroy(gravityVec);
    }
  }

  #findClosestRigidBodyComponent(): JoltRigidBodyComponent | undefined {
    let parent: JoltRigidBodyComponent | Object3DComponent | null =
      this.parentComponent;
    let depth = 0;
    const maxDepth = 10;
    while (parent) {
      if (parent instanceof JoltRigidBodyComponent) return parent;
      parent = parent.parent;
      depth++;
      if (depth > maxDepth) {
        console.warn(
          '<waterBuoyancy>: max depth reached, cannot find a parent <jolt-rigid-body>.',
        );
        return undefined;
      }
    }
    return undefined;
  }
}
