import { Object3D, Vector3, type Vector3Like, type Vector3Tuple } from 'three';

export type Position3 = Vector3Like | Vector3Tuple;

export interface FloatingOriginOptions {
  /** Maximum distance from the local origin before an automatic rebase. */
  threshold?: number;
}

export interface FloatingOriginRebase {
  /** Translation from the old origin to the new origin, in world units. */
  readonly delta: Vector3;
  readonly previousOrigin: Vector3;
  readonly origin: Vector3;
  readonly anchorWorldPosition: Vector3;
}

export type FloatingOriginListener = (event: FloatingOriginRebase) => void;

/**
 * Converts double-precision application/world positions into small Three.js
 * render-space positions. Rebases are synchronous so physics, scene objects,
 * cameras, and other app state can change coordinate frames atomically.
 *
 * The class deliberately does not own a scene or a game loop. Consumers call
 * `rebaseIfNeeded` when their authoritative position is known and decide how
 * each subsystem responds through `onRebase`.
 */
export class FloatingOrigin {
  readonly origin = new Vector3();
  readonly threshold: number;

  readonly #listeners = new Set<FloatingOriginListener>();
  readonly #scratchLocal = new Vector3();

  constructor(options: FloatingOriginOptions = {}) {
    this.threshold = options.threshold ?? 10_000;
    if (!Number.isFinite(this.threshold) || this.threshold <= 0) {
      throw new Error('FloatingOrigin threshold must be a positive finite number.');
    }
  }

  toLocal(worldPosition: Position3, target = new Vector3()): Vector3 {
    return copyPosition(target, worldPosition).sub(this.origin);
  }

  toWorld(localPosition: Position3, target = new Vector3()): Vector3 {
    return copyPosition(target, localPosition).add(this.origin);
  }

  rebaseIfNeeded(worldAnchor: Position3): FloatingOriginRebase | undefined {
    this.toLocal(worldAnchor, this.#scratchLocal);
    if (this.#scratchLocal.lengthSq() <= this.threshold * this.threshold) {
      return undefined;
    }
    return this.rebase(worldAnchor);
  }

  rebase(worldAnchor: Position3): FloatingOriginRebase {
    const previousOrigin = this.origin.clone();
    const anchorWorldPosition = copyPosition(new Vector3(), worldAnchor);
    this.origin.copy(anchorWorldPosition);

    const event: FloatingOriginRebase = {
      delta: this.origin.clone().sub(previousOrigin),
      previousOrigin,
      origin: this.origin.clone(),
      anchorWorldPosition,
    };
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  onRebase(listener: FloatingOriginListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reset(): void {
    if (this.origin.lengthSq() === 0) return;
    this.rebase([0, 0, 0]);
  }

  /** Standard handler for scene objects stored in the current local frame. */
  static shiftObject(object: Object3D, event: FloatingOriginRebase): void {
    object.position.sub(event.delta);
  }
}

/**
 * Keeps an orbit-style camera and target locked to an authoritative local
 * position without reading it back from an Object3D or relying on effect order.
 */
export class CameraFollowController {
  readonly #previous = new Vector3();
  readonly #next = new Vector3();
  #hasPrevious = false;

  constructor(
    readonly camera: Object3D,
    readonly target: Vector3,
  ) {}

  update(position: Position3): void {
    copyPosition(this.#next, position);
    if (!this.#hasPrevious) {
      const initialDelta = this.#next.clone().sub(this.target);
      this.camera.position.add(initialDelta);
      this.target.copy(this.#next);
      this.#previous.copy(this.#next);
      this.#hasPrevious = true;
      return;
    }

    const delta = this.#next.clone().sub(this.#previous);
    this.camera.position.add(delta);
    this.target.add(delta);
    this.#previous.copy(this.#next);
  }

  applyRebase(event: FloatingOriginRebase): void {
    this.camera.position.sub(event.delta);
    this.target.sub(event.delta);
    if (this.#hasPrevious) this.#previous.sub(event.delta);
  }

  clear(): void {
    this.#hasPrevious = false;
  }
}

function copyPosition(target: Vector3, position: Position3): Vector3 {
  if (Array.isArray(position)) return target.set(...position);
  return target.copy(position);
}
