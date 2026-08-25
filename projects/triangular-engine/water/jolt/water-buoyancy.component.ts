import { Component, DestroyRef, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Vector3, type Vector3Tuple } from 'three';
import { EngineService, Object3DComponent } from 'triangular-engine';
import {
  Jolt,
  JoltPhysicsService,
  JoltRigidBodyComponent,
  wrapQuat,
  wrapVec3,
} from 'triangular-engine/jolt';
import { WaterService } from 'triangular-engine/water';
import {
  DEFAULT_WATER_BUOYANCY_SETTINGS,
  resolveWaterBuoyancyImpulseInput,
} from './water-buoyancy';

/**
 * Attaches to a parent `<joltRigidBody>` (same upward-DI pattern as the
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
  /**
   * Local hull points used to derive one effective water plane. Supplying
   * several points makes a long vessel respond to the sea under its whole
   * waterline instead of one wave directly below its centre of mass.
   */
  readonly probePoints = input<readonly Vector3Tuple[]>([]);
  /**
   * `up` is useful for very large displacement vessels: it averages wave
   * height but does not let local Gerstner slopes push the entire hull
   * sideways. Existing consumers retain the single sampled normal behaviour.
   */
  readonly probeNormal = input<'sample' | 'average' | 'up'>('sample');
  /**
   * `jolt` delegates to Jolt's generic submerged-volume impulse. `stabilized`
   * is a vessel support model: a critically damped, one-way vertical force
   * toward a declared waterline. It is suited to large ships whose hull
   * displacement is not represented by a single primitive collision volume.
   */
  readonly supportMode = input<'jolt' | 'stabilized'>('jolt');
  /** Local body Y that should meet the sampled waterline in stabilized mode. */
  readonly waterlineOffset = input(0);
  /** Spring acceleration per metre of waterline error, in s^-2. */
  readonly heaveStiffness = input(1.2);
  /** Vertical-velocity damping, in s^-1. */
  readonly heaveDamping = input(3.5);
  /** Upper bound on buoyant acceleration, in m/s^2. */
  readonly maxSupportAcceleration = input(20);

  /** Fires once when the tracked body's position crosses below the surface. */
  readonly onEnterWater = output<void>();
  /** Fires once when the tracked body's position crosses back above the surface. */
  readonly onExitWater = output<void>();

  private readonly rigidBodyComponent = this.#findClosestRigidBodyComponent();
  private readonly trackedPosition = new Vector3();
  private readonly probePosition = new Vector3();
  private readonly accumulatedNormal = new Vector3();
  private readonly accumulatedFlow = new Vector3();

  constructor() {
    if (!this.rigidBodyComponent) {
      console.error(
        '<waterBuoyancy> must be nested inside a <joltRigidBody>.',
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
    const sample = this.#sampleHullWater(
      position,
      wrapQuat(body.GetRotation()),
      elapsedSeconds,
    );
    if (!sample) return;

    const gravity = wrapVec3(metadata.physicsSystem.GetGravity());
    if (this.supportMode() === 'stabilized') {
      this.#applyStabilizedSupport(body, position, sample.position.y, gravity.y);
      return;
    }
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

  #applyStabilizedSupport(
    body: NonNullable<JoltRigidBodyComponent['body$']['value']>,
    position: Vector3,
    waterHeight: number,
    gravityY: number,
  ): void {
    const inverseMass = body.GetMotionProperties().GetInverseMass();
    if (inverseMass <= 0) return;
    const verticalVelocity = wrapVec3(body.GetLinearVelocity()).y;
    const waterlineError = waterHeight + this.waterlineOffset() - position.y;
    // Buoyancy is one-way: it can arrest a fall and lift a submerged hull,
    // but never pulls a vessel down toward the water from above.
    const acceleration = Math.min(
      this.maxSupportAcceleration(),
      Math.max(
        0,
        -gravityY +
          this.heaveStiffness() * waterlineError -
          this.heaveDamping() * verticalVelocity,
      ),
    );
    if (acceleration === 0) return;
    const force = new Jolt.Vec3(0, acceleration / inverseMass, 0);
    try {
      body.AddForce(force);
    } finally {
      Jolt.destroy(force);
    }
  }

  #sampleHullWater(
    position: Vector3,
    rotation: ReturnType<typeof wrapQuat>,
    elapsedSeconds: number,
  ): {
    readonly position: Vector3;
    readonly normal: Vector3;
    readonly flow: Vector3;
  } | null {
    const probes = this.probePoints();
    if (probes.length === 0) {
      return this.water.sample(position, elapsedSeconds);
    }

    this.accumulatedNormal.set(0, 0, 0);
    this.accumulatedFlow.set(0, 0, 0);
    let height = 0;
    let count = 0;
    for (const probe of probes) {
      this.probePosition
        .set(...probe)
        .applyQuaternion(rotation)
        .add(position);
      const sample = this.water.sample(this.probePosition, elapsedSeconds);
      if (!sample) continue;
      height += sample.position.y;
      this.accumulatedNormal.add(sample.normal);
      this.accumulatedFlow.add(sample.flow);
      count++;
    }
    if (count === 0) return null;

    this.probePosition.set(position.x, height / count, position.z);
    const normalMode = this.probeNormal();
    if (normalMode === 'up') this.accumulatedNormal.set(0, 1, 0);
    else if (normalMode === 'average') this.accumulatedNormal.normalize();
    else {
      const centreSample = this.water.sample(position, elapsedSeconds);
      if (centreSample) this.accumulatedNormal.copy(centreSample.normal);
      else this.accumulatedNormal.normalize();
    }
    this.accumulatedFlow.multiplyScalar(1 / count);
    return {
      position: this.probePosition.clone(),
      normal: this.accumulatedNormal.clone(),
      flow: this.accumulatedFlow.clone(),
    };
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
          '<waterBuoyancy>: max depth reached, cannot find a parent <joltRigidBody>.',
        );
        return undefined;
      }
    }
    return undefined;
  }
}
