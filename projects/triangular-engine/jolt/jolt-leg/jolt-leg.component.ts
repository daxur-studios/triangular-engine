import {
  Component,
  DestroyRef,
  inject,
  input,
  OnDestroy,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { Vector3Tuple } from 'three';
import { LAYER_MOVING } from '../example';
import {
  IJoltMetadata,
  Jolt,
  JoltPhysicsService,
} from '../jolt-physics/jolt-physics.service';
import { JoltRigidBodyComponent } from '../jolt-rigid-body/jolt-rigid-body.component';

/** Emitted each physics tick while the leg's foot rests on something. */
export interface ILegContact {
  /** Foot world position (the ray hit point). */
  readonly worldPosition: [number, number, number];
  /** Current suspension compression in meters (maxLength - hit distance). */
  readonly extension: number;
  /** True while the foot transfers support to the host. */
  readonly grounded: boolean;
}

/**
 * Standalone ray-cast suspension leg. Each physics tick this primitive casts a
 * ray from the host rigid body's local anchor along the leg's local `direction`
 * and — when it lands — pushes the host away from the contact point with a
 * mass-tuned spring-damper (k = m·ω², c = 2·ζ·√(m·k)) plus a grip term that
 * brakes the foot's lateral slip against whatever it stands on.
 *
 * Why not a VehicleConstraint: Jolt's vehicle is welded to ONE chassis body
 * and drags an engine/gearbox/controller along. Landing legs are universal —
 * mount the same ray-cast support on ANY part, on any side, on any body — so
 * this primitive exists outside the vehicle family entirely.
 */
@Component({
  selector: 'joltLeg',
  imports: [],
  template: `<ng-content></ng-content>`,
})
export class JoltLandingLegComponent implements OnDestroy {
  readonly physicsService = inject(JoltPhysicsService);
  readonly destroyRef = inject(DestroyRef);

  /** Host body this leg is bolted to, as a component ref or an id string. */
  readonly host = input<JoltRigidBodyComponent | string>();

  /** Leg anchor, local to the host body, meters. Default: under the origin. */
  readonly position = input<Vector3Tuple>([0, 0, 0]);

  /** Ray direction ("down" axis) local to the host; need not be normalized. */
  readonly direction = input<Vector3Tuple>([0, -1, 0]);

  /** Full suspension travel, meters (foot is level when stretched this far). */
  readonly maxLength = input(0.5);

  /** Natural oscillation frequency of the suspension spring, Hz. */
  readonly frequency = input(2);

  /** Spring damping ratio (0..1; 1 = critically damped). */
  readonly damping = input(0.5);

  /** Grip coupling that arrests lateral slip of the foot against the ground. */
  readonly grip = input(0.8);

  /** Fires every tick with the solved foot contact (or undefined while lifted). */
  readonly contact = output<ILegContact | undefined>();
  readonly contact$ = new BehaviorSubject<ILegContact | undefined>(undefined);

  #runtime:
    | {
        metadata: IJoltMetadata;
        jolt: typeof Jolt;
        query: Jolt.NarrowPhaseQuery;
        broadPhaseFilter: Jolt.BroadPhaseLayerFilter;
        objectLayerFilter: Jolt.ObjectLayerFilter;
        shapeFilter: Jolt.ShapeFilter;
        bodyFilter: Jolt.BodyFilter;
        bodyFilterHost: Jolt.BodyID | undefined;
      }
    | undefined;

  constructor() {
    this.#initAsync();
  }

  async #initAsync(): Promise<void> {
    const metadata = await this.physicsService.metaDataPromise;
    if (this.destroyRef.destroyed) return;
    this.#runtime = this.#createRuntime(metadata);
    this.physicsService.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.#step(metadata);
    });
  }

  #createRuntime(metadata: IJoltMetadata): NonNullable<typeof this.#runtime> {
    const J = metadata.Jolt;

    // Two accept-all layer filters so the ray sees every surface; the host body
    // itself is subtracted in #step via the body filter.
    const vsBroadPhase = new J.ObjectVsBroadPhaseLayerFilterJS();
    vsBroadPhase.ShouldCollide = () => true;
    const objectPair = new J.ObjectLayerPairFilterJS();
    objectPair.ShouldCollide = () => true;
    const shape = new J.ShapeFilterJS();
    shape.ShouldCollide = () => true;

    return {
      metadata,
      jolt: J,
      query: metadata.physicsSystem.GetNarrowPhaseQuery(),
      broadPhaseFilter: new J.DefaultBroadPhaseLayerFilter(vsBroadPhase, LAYER_MOVING),
      objectLayerFilter: new J.DefaultObjectLayerFilter(objectPair, LAYER_MOVING),
      shapeFilter: shape,
      bodyFilter: new J.BodyFilterJS(),
    };
  }

  #step(metadata: IJoltMetadata): void {
    const runtime = this.#runtime;
    if (!runtime) return;

    const body = this.#resolveBody();
    if (!body || body.IsStatic() || body.IsKinematic()) {
      this.#emit(undefined);
      return;
    }

    const J = runtime.jolt;
    const world = body.GetWorldTransform(); // RMat44

    const localPos = new J.Vec3(...this.position());
    const localDir = new J.Vec3(...this.direction());
    const dirMag = localDir.Length();
    if (dirMag === 0) {
      J.destroy(localPos);
      J.destroy(localDir);
      this.#emit(undefined);
      return;
    }

    const startWorld = world.MulVec3(localPos); // RVec3 foot anchor line start
    const axis = world.Multiply3x3(localDir).Mul(1 / dirMag); // world "down", unit
    const rayLen = this.maxLength();

    // Cast a ray down the foot axis, ignoring the host body itself.
    const ray = new J.RRayCast(startWorld, axis.Mul(rayLen));
    const raySettings = new J.RayCastSettings();
    const collector = new J.CastRayClosestHitCollisionCollector();

    runtime.bodyFilter.ShouldCollide = (id: number) => id !== body.GetID();

    try {
      runtime.query.CastRay(
        ray,
        raySettings,
        collector,
        runtime.broadPhaseFilter,
        runtime.objectLayerFilter,
        runtime.bodyFilter,
        runtime.shapeFilter,
      );

      if (!collector.HadHit()) {
        this.#emit(undefined);
        return;
      }

      const hit = collector.mHit;
      const fraction = hit.mFraction;
      const hitDist = Math.min(rayLen, Math.max(0, fraction * rayLen));
      const extension = rayLen - hitDist; // positive when compressed
      const hitWorld = ray.GetPointOnRay(fraction); // RVec3

      // Spring-damper: k = m·ω², c = 2·ζ·m·ω; support pushes +world "down"
      // opposite of the axis (surfaces push the body away from the foot).
      const mass = 1 / Math.max(1e-6, body.GetMotionProperties().GetInverseMass());
      const omega = 2 * Math.PI * this.frequency();
      const k = mass * (omega * omega);
      const c = 2 * this.damping() * mass * omega;

      const velAtFoot = metadata.bodyInterface.GetPointVelocity(body.GetID(), hitWorld);
      const axisVel = velAtFoot.Dot(axis); // positive = bunch toward the ground
      const loadForce = Math.max(0, k * extension - c * axisVel);

      if (loadForce > 0) {
        const supportPush = axis.Mul(loadForce);
        metadata.bodyInterface.AddForce(
          body.GetID(),
          supportPush,
          hitWorld,
          J.EActivation_Activate,
        );

        const gripGain = this.grip();
        if (gripGain > 0) {
          // Lateral slip = velocity perpendicular to the foot axis. KiLL it
          // with a clamp-backed friction term.
          const lateral = velAtFoot.Sub(axis.Mul(axisVel));
          const speed = lateral.Length();
          if (speed > 1e-5) {
            const clampMax = gripGain * loadForce;
            const applyScale = Math.min(1, clampMax / speed);
            const gripForce = lateral.Mul(-applyScale * 1);
            metadata.bodyInterface.AddForce(
              body.GetID(),
              gripForce,
              hitWorld,
              J.EActivation_Activate,
            );
            J.destroy(gripForce);
          }
          J.destroy(lateral);
        }

        J.destroy(supportPush);
      }
      J.destroy(velAtFoot);

      this.#emit({
        position: [hitWorld.GetX(), hitWorld.GetY(), hitWorld.GetZ()],
        extension,
        grounded: true,
      });
      J.destroy(hitWorld);
    } finally {
      J.destroy(ray);
      J.destroy(raySettings);
      J.destroy(collector);
      J.destroy(axis);
      J.destroy(localDir);
      J.destroy(localPos);
      J.destroy(startWorld);
    }
  }

  #resolveBody(): Jolt.Body | undefined {
    const host = this.host();
    if (!host) return undefined;
    if (typeof host === 'string') {
      return this.physicsService.getRigidBodyById(host)();
    }
    return host.body();
  }

  #emit(contact: ILegContact | undefined): void {
    this.contact$.next(contact);
    this.contact.emit(contact);
  }

  ngOnDestroy(): void {
    this.#runtime = undefined;
  }
}