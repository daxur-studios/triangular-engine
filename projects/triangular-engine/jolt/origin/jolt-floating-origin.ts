import type { Vector3Tuple } from 'three';
import { FloatingOrigin, type FloatingOriginRebase } from 'triangular-engine';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';

export interface IJoltOriginOptions {
  /**
   * Distance in metres from the physics origin at which `update` rebases. Defaults to the
   * core `FloatingOrigin` default (10 000 m).
   */
  readonly thresholdM?: number;
}

/**
 * Keeps single-precision Jolt bodies accurate far from the world origin.
 *
 * Jolt stores positions as float32, so a body at 1e7 m cannot hold a 0.125 m offset. This
 * class owns the rebase policy (a core `FloatingOrigin`) and shifts every tracked body by the
 * opposite of the origin's move, so the physics frame stays small. Velocities are not changed,
 * and bodies are not activated by a rebase.
 *
 * Call `update` once per frame (or per physics tick) with the authoritative world anchor, in
 * metres. Subscribe to `origin.onRebase` for scene objects or cameras that also live in the
 * physics frame. The class does not step physics or subscribe to any stream itself.
 */
export class JoltFloatingOrigin {
  /** The rebase policy and current physics origin, in world metres. Read `origin.origin` for it. */
  readonly origin: FloatingOrigin;

  readonly #physicsService: JoltPhysicsService;
  readonly #extraBodies = new Set<Jolt.Body>();

  constructor(physicsService: JoltPhysicsService, options: IJoltOriginOptions = {}) {
    this.#physicsService = physicsService;
    this.origin = new FloatingOrigin({ threshold: options.thresholdM });
  }

  /**
   * Rebases if `anchorWorldM` is further than the threshold from the current origin, and shifts
   * all bodies when it does.
   *
   * @param anchorWorldM Authoritative world position in metres.
   * @returns The rebase event, or `undefined` when no rebase happened.
   * @throws If Jolt is not initialised. The origin is not changed in that case.
   */
  update(anchorWorldM: Vector3Tuple): FloatingOriginRebase | undefined {
    const bodyInterface = this.#requireBodyInterface();
    const event = this.origin.rebaseIfNeeded(anchorWorldM);
    if (event) this.#shiftBodies(bodyInterface, event);
    return event;
  }

  /**
   * Rebases unconditionally to `anchorWorldM` and shifts all bodies.
   *
   * @param anchorWorldM New physics origin in world metres.
   * @throws If Jolt is not initialised. The origin is not changed in that case.
   */
  rebaseTo(anchorWorldM: Vector3Tuple): FloatingOriginRebase {
    const bodyInterface = this.#requireBodyInterface();
    const event = this.origin.rebase(anchorWorldM);
    this.#shiftBodies(bodyInterface, event);
    return event;
  }

  /**
   * Adds a body that is not in `JoltPhysicsService.bodies$` (for example a static terrain
   * collider) so that rebases move it too.
   */
  track(body: Jolt.Body): void {
    this.#extraBodies.add(body);
  }

  /** Stops shifting a body added with `track`. Bodies in `bodies$` are unaffected. */
  untrack(body: Jolt.Body): void {
    this.#extraBodies.delete(body);
  }

  /** Forgets every body added with `track`. The origin itself is kept. */
  dispose(): void {
    this.#extraBodies.clear();
  }

  #requireBodyInterface(): Jolt.BodyInterface {
    const bodyInterface = this.#physicsService.metaData$.value?.bodyInterface;
    if (!bodyInterface) {
      throw new Error('JoltFloatingOrigin: Jolt is not initialised.');
    }
    return bodyInterface;
  }

  #shiftBodies(bodyInterface: Jolt.BodyInterface, event: FloatingOriginRebase): void {
    const bodies = this.#physicsService.bodies$.value;
    for (const body of bodies) this.#shiftBody(bodyInterface, body, event);
    for (const body of this.#extraBodies) {
      if (bodies.includes(body)) continue;
      this.#shiftBody(bodyInterface, body, event);
    }
  }

  #shiftBody(bodyInterface: Jolt.BodyInterface, body: Jolt.Body, event: FloatingOriginRebase): void {
    const id = body.GetID();
    const position = body.GetPosition();
    const next = new Jolt.RVec3(
      position.GetX() - event.delta.x,
      position.GetY() - event.delta.y,
      position.GetZ() - event.delta.z,
    );
    try {
      bodyInterface.SetPosition(id, next, Jolt.EActivation_DontActivate);
    } finally {
      Jolt.destroy(next);
    }
  }
}
