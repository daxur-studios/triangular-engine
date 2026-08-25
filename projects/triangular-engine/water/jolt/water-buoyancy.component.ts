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

const WORLD_UP = new Vector3(0, 1, 0);
const STABILIZED_RIGHTING_TORQUE_PER_KG = 140;
const STABILIZED_ANGULAR_DAMPING_PER_KG = 20;

/** One locally sampled volume of a vessel hull, in body-local metres. */
export interface WaterDisplacementCell {
  readonly position: Vector3Tuple;
  readonly dimensions: [number, number, number];
}

/**
 * Attaches to a parent `<joltRigidBody>` (same upward-DI pattern as the
 * `jolt-*-shape` components) and, once per physics substep before `Step()`,
 * samples the registered `WaterSurface` at the body's position. The default
 * mode delegates to `Jolt.Body#ApplyBuoyancyImpulse`; `displacement` applies
 * Archimedes support through authored hull cells — see
 * docs/runbook/002_water_sublibrary.md, "Jolt buoyancy".
 *
 * Water remains surface-sampled (so waves, lakes, and rivers work without a
 * global boxed volume). Long hulls should use `displacementCells`, whose
 * individual samples distribute force across the waterline.
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
   * `jolt` delegates to Jolt's generic submerged-volume impulse.
   * `stabilized` is the older waterline spring POC. `displacement` derives
   * support from finite hull cells and is the preferred vessel mode.
   */
  readonly supportMode = input<'jolt' | 'stabilized' | 'displacement'>('jolt');
  /** Hull volumes used by `displacement` support mode. */
  readonly displacementCells = input<readonly WaterDisplacementCell[]>([]);
  /** Float reserve at fully submerged hull volume. Values above 1 add freeboard. */
  readonly displacementBuoyancy = input(1.25);
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
    if (this.supportMode() === 'displacement') {
      this.#applyDisplacementSupport(
        body,
        position,
        wrapQuat(body.GetRotation()),
        elapsedSeconds,
        gravity.y,
      );
      return;
    }
    if (this.supportMode() === 'stabilized') {
      this.#applyStabilizedSupport(
        body,
        position,
        wrapQuat(body.GetRotation()),
        elapsedSeconds,
        gravity.y,
      );
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
    rotation: ReturnType<typeof wrapQuat>,
    elapsedSeconds: number,
    gravityY: number,
  ): void {
    const inverseMass = body.GetMotionProperties().GetInverseMass();
    if (inverseMass <= 0) return;
    const verticalVelocity = wrapVec3(body.GetLinearVelocity()).y;
    const massKg = 1 / inverseMass;
    const probes = this.probePoints();
    const samples: { readonly point: Vector3; readonly height: number }[] = [];
    let totalRawAcceleration = 0;
    for (const probe of probes.length ? probes : [[0, 0, 0] as Vector3Tuple]) {
      const point = new Vector3()
        .set(...probe)
        .applyQuaternion(rotation)
        .add(position);
      const sample = this.water.sample(point, elapsedSeconds);
      if (!sample) continue;
      const rawAcceleration = Math.max(
        0,
        -gravityY +
          this.heaveStiffness() *
            (sample.position.y + this.waterlineOffset() - position.y) -
          this.heaveDamping() * verticalVelocity,
      );
      samples.push({ point, height: rawAcceleration });
      totalRawAcceleration += rawAcceleration;
    }
    if (samples.length === 0) return;

    // Distribute the support over the hull instead of applying it at the
    // centre of mass. Uneven wave heights now create real pitch/roll moments,
    // while the bounded total support lets an overloaded boat sink fully.
    const totalAcceleration = Math.min(
      this.maxSupportAcceleration(),
      totalRawAcceleration / samples.length,
    );
    const supportScale = totalRawAcceleration > 0
      ? (totalAcceleration * samples.length) / totalRawAcceleration
      : 0;
    for (const sample of samples) {
      const force = new Jolt.Vec3(
        0,
        (massKg * sample.height * supportScale) / samples.length,
        0,
      );
      const worldPoint = new Jolt.RVec3(
        sample.point.x,
        sample.point.y,
        sample.point.z,
      );
      try {
        body.AddForce(force, worldPoint);
      } finally {
        Jolt.destroy(force);
        Jolt.destroy(worldPoint);
      }
    }

    const bodyUp = WORLD_UP.clone().applyQuaternion(rotation);
    const rightingAxis = bodyUp.clone().cross(WORLD_UP);
    const angularVelocity = wrapVec3(body.GetAngularVelocity());
    const torque = rightingAxis
      .multiplyScalar(massKg * STABILIZED_RIGHTING_TORQUE_PER_KG)
      .add(
        new Vector3(-angularVelocity.x, -angularVelocity.y, -angularVelocity.z)
          .multiplyScalar(massKg * STABILIZED_ANGULAR_DAMPING_PER_KG),
      );
    const jTorque = new Jolt.Vec3(torque.x, torque.y, torque.z);
    try {
      body.AddTorque(jTorque);
    } finally {
      Jolt.destroy(jTorque);
    }
  }

  #applyDisplacementSupport(
    body: NonNullable<JoltRigidBodyComponent['body$']['value']>,
    position: Vector3,
    rotation: ReturnType<typeof wrapQuat>,
    elapsedSeconds: number,
    gravityY: number,
  ): void {
    const cells = this.displacementCells();
    if (cells.length === 0) return;
    const inverseMass = body.GetMotionProperties().GetInverseMass();
    if (inverseMass <= 0) return;

    const totalVolumeM3 = cells.reduce(
      (total, cell) =>
        total + cell.dimensions[0] * cell.dimensions[1] * cell.dimensions[2],
      0,
    );
    if (totalVolumeM3 <= 0) return;

    const massKg = 1 / inverseMass;
    const verticalVelocity = wrapVec3(body.GetLinearVelocity()).y;
    const gravityMagnitude = Math.max(0, -gravityY);
    for (const cell of cells) {
      const point = new Vector3()
        .set(...cell.position)
        .applyQuaternion(rotation)
        .add(position);
      const sample = this.water.sample(point, elapsedSeconds);
      if (!sample) continue;

      const heightM = cell.dimensions[1];
      const bottomY = point.y - heightM / 2;
      const submergedFraction = Math.max(
        0,
        Math.min(1, (sample.position.y - bottomY) / heightM),
      );
      if (submergedFraction === 0) continue;

      const volumeFraction =
        (cell.dimensions[0] * heightM * cell.dimensions[2]) / totalVolumeM3;
      const buoyancyAcceleration =
        gravityMagnitude *
        this.displacementBuoyancy() *
        volumeFraction *
        submergedFraction;
      const dragAcceleration =
        -this.linearDrag() * verticalVelocity * volumeFraction * submergedFraction;
      const force = new Jolt.Vec3(
        0,
        massKg * (buoyancyAcceleration + dragAcceleration),
        0,
      );
      const worldPoint = new Jolt.RVec3(point.x, point.y, point.z);
      try {
        body.AddForce(force, worldPoint);
      } finally {
        Jolt.destroy(force);
        Jolt.destroy(worldPoint);
      }
    }

    // A hull's uneven submersion supplies its own righting moment. This term
    // only dissipates residual spin from cargo impacts and wave transients.
    const angularVelocity = wrapVec3(body.GetAngularVelocity());
    const angularDragTorque = new Jolt.Vec3(
      -massKg * this.angularDrag() * angularVelocity.x,
      -massKg * this.angularDrag() * angularVelocity.y,
      -massKg * this.angularDrag() * angularVelocity.z,
    );
    try {
      body.AddTorque(angularDragTorque);
    } finally {
      Jolt.destroy(angularDragTorque);
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
