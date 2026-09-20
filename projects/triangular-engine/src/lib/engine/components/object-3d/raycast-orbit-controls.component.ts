import { Component, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Camera, MOUSE, Object3D, Raycaster, Vector2, Vector3, Vector3Tuple } from 'three';

import { AdvancedOrbitControls } from '../../models';
import { OrbitControlsComponent } from './orbit-controls.component';
import { RaycastService } from './raycast';

/** Pointer-button actions supported by `RaycastOrbitControlsComponent`. */
export type RaycastOrbitMouseAction = 'none' | 'pan' | 'rotate';

/** Inputs supplied to a game-defined test for whether a pointer ray has hit usable ground. */
export interface RaycastFocusContext {
  readonly raycaster: Raycaster;
  readonly camera: Camera;
  readonly ndc: Vector2;
  readonly sceneChildren: readonly Object3D[];
}

/** Resolves the point that wheel zoom and rotation should focus, or rejects the pointer ray. */
export type RaycastFocusResolver = (
  context: RaycastFocusContext,
) => Vector3 | Vector3Tuple | null;

/** Ignore distance ratios close enough to one that they are only floating-point noise. */
const ZOOM_RATIO_EPSILON = 1e-6;
/** Keep the camera just above the surface point used by a zoom interaction. */
const DEFAULT_SURFACE_CLEARANCE_M = 0.5;
/** Smooth, short pivot handoff applied as a rotate gesture begins. */
const DEFAULT_ROTATE_HANDOFF_DURATION_S = 0.18;

function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

function toThreeMouseAction(action: RaycastOrbitMouseAction): number | null {
  switch (action) {
    case 'pan': return MOUSE.PAN;
    case 'rotate': return MOUSE.ROTATE;
    case 'none': return null;
  }
}

/**
 * Orbit controls that zoom and rotate around valid ground beneath the pointer,
 * inspired by world-navigation cameras such as Black & White.
 *
 * The host owns what counts as ground through `raycastFocusResolver`; this
 * component owns the gesture timing, fallback focus point, and camera math.
 */
@Component({
  selector: 'raycastOrbitControls',
  template: '<ng-content />',
  imports: [],
})
export class RaycastOrbitControlsComponent extends OrbitControlsComponent {
  /** Game-defined terrain/world raycast. `null` falls back to a distance-scaled point along the pointer ray. */
  readonly raycastFocusResolver = input<RaycastFocusResolver>();
  /** Whether wheel/pinch dolly shifts the pivot toward the current pointer focus. */
  readonly zoomToCursor = input(true);
  /** Minimum camera-to-surface distance while zooming toward a resolved terrain hit. */
  readonly surfaceClearanceM = input(DEFAULT_SURFACE_CLEARANCE_M);
  /** Whether a rotate gesture first shifts its pivot toward the current pointer focus. */
  readonly rotateToCursor = input(true);
  /** Action bound to primary (left) mouse button. Defaults to none so placement/select UIs retain it. */
  readonly leftMouseAction = input<RaycastOrbitMouseAction>('none');
  /** Action bound to auxiliary (middle) mouse button. */
  readonly middleMouseAction = input<RaycastOrbitMouseAction>('rotate');
  /** Action bound to secondary (right) mouse button. */
  readonly rightMouseAction = input<RaycastOrbitMouseAction>('pan');
  /** Duration of the eased rotate-pivot handoff. Set to zero to snap directly to the hit point. */
  readonly rotateHandoffDurationS = input(DEFAULT_ROTATE_HANDOFF_DURATION_S);

  readonly #cursorPositionM = signal<Vector3Tuple | null>(null);
  /** Valid focus point under the pointer, including a camera-distance fallback when no resolver hit exists. */
  readonly cursorPositionM = this.#cursorPositionM.asReadonly();
  readonly #raycast = inject(RaycastService);
  #rotateLockHandoff: { readonly fromTarget: Vector3; readonly toTarget: Vector3; elapsedS: number } | null = null;
  #lastDistanceToTargetM: number | null = null;
  #cursorIsSurfaceHit = false;
  readonly #activePointerIds = new Set<number>();
  #pendingZoom: {
    readonly fromCamera: Vector3;
    readonly fromTarget: Vector3;
    readonly focusPoint: Vector3;
    readonly surfaceHit: boolean;
  } | null = null;

  constructor() {
    super();
    this.#initExternalPoseChanges();
    this.#initMouseButtons();
    this.#initCursorTracking();
    this.#initWheelCapture();
    this.#initRotateTowardCursor();
    this.#initZoomAnchorCompensation();
  }

  #initExternalPoseChanges(): void {
    effect(() => {
      // A declarative camera jump is not a cursor dolly. Otherwise the next
      // tick compares the new bookmark distance with the old distance and
      // translates BOTH camera and target toward a stale cursor (or far past
      // it when returning to overview). Cancel a pending rotate handoff too.
      this.target();
      this.cameraPosition();
      this.moveBy();
      this.follow();
      this.orbitControls();
      this.isActive();
      this.zoomToCursor();
      this.#lastDistanceToTargetM = null;
      this.#rotateLockHandoff = null;
      this.#cursorPositionM.set(null);
      this.#cursorIsSurfaceHit = false;
      this.#pendingZoom = null;
    });
  }

  #initMouseButtons(): void {
    effect(() => {
      const orbit = this.orbitControls();
      if (!orbit) return;
      orbit.mouseButtons.LEFT = toThreeMouseAction(this.leftMouseAction());
      orbit.mouseButtons.MIDDLE = toThreeMouseAction(this.middleMouseAction());
      orbit.mouseButtons.RIGHT = toThreeMouseAction(this.rightMouseAction());
    });
  }

  #initCursorTracking(): void {
    this.engineService.mousemove$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (event) => this.#updateCursorPosition(event),
    );
    this.engineService.wheel$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (event) => this.#beginWheelZoom(event),
    );
  }

  /** Capture on the actual OrbitControls element so this runs before its dolly listeners. */
  #initWheelCapture(): void {
    effect((onCleanup) => {
      const orbit = this.orbitControls();
      if (!orbit) return;
      const domElement = orbit.domElement;
      if (!domElement) return;

      const onWheel = (event: Event) => this.#beginWheelZoom(event as WheelEvent);
      const onPointerDown = (event: Event) => {
        this.#activePointerIds.add((event as PointerEvent).pointerId);
      };
      const onPointerMove = (event: Event) => {
        if (this.#activePointerIds.size >= 2) {
          this.#beginWheelZoom(event as PointerEvent);
        }
      };
      const onPointerUp = (event: Event) => {
        this.#activePointerIds.delete((event as PointerEvent).pointerId);
      };
      domElement.addEventListener('wheel', onWheel, { capture: true });
      domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
      domElement.addEventListener('pointermove', onPointerMove, { capture: true });
      domElement.addEventListener('pointerup', onPointerUp, { capture: true });
      domElement.addEventListener('pointercancel', onPointerUp, { capture: true });
      onCleanup(() => {
        domElement.removeEventListener('wheel', onWheel, { capture: true });
        domElement.removeEventListener('pointerdown', onPointerDown, { capture: true });
        domElement.removeEventListener('pointermove', onPointerMove, { capture: true });
        domElement.removeEventListener('pointerup', onPointerUp, { capture: true });
        domElement.removeEventListener('pointercancel', onPointerUp, { capture: true });
        this.#activePointerIds.clear();
      });
    });
  }

  #updateCursorPosition(event: MouseEvent | null): void {
    if (!event || !this.isActive()) return;
    const resolution = this.engineService.resolution$.value;
    const ndc = new Vector2(((event.offsetX ?? 0) / resolution.width) * 2 - 1, -((event.offsetY ?? 0) / resolution.height) * 2 + 1);
    const raycaster = this.#raycast.raycaster;
    raycaster.setFromCamera(ndc, this.engineService.camera);
    const resolved = this.raycastFocusResolver()?.({ raycaster, camera: this.engineService.camera, ndc, sceneChildren: this.engineService.scene.children });
    if (resolved) {
      this.#cursorPositionM.set(resolved instanceof Vector3 ? resolved.toArray() : resolved);
      this.#cursorIsSurfaceHit = true;
      return;
    }
    const orbit = this.orbitControls();
    if (!orbit) return;
    const fallback = new Vector3();
    raycaster.ray.at(orbit.target.distanceTo(this.internalCamera.position), fallback);
    this.#cursorPositionM.set(fallback.toArray() as Vector3Tuple);
    this.#cursorIsSurfaceHit = false;
  }

  /**
   * Wheel events are the start of a new zoom interaction. Re-sample the ray
   * here instead of relying on the last mousemove: terrain LOD and morphing
   * can change the hit while the pointer remains still.
   */
  #beginWheelZoom(event: WheelEvent | PointerEvent | null): void {
    if (!event || !this.isActive() || !this.zoomToCursor()) return;

    // The native capture listener has already sampled this wheel when the
    // engine's wrapper-level wheel event bubbles to this subscriber.
    if (this.#pendingZoom) return;

    this.#updateCursorPosition(event);
    const orbit = this.orbitControls();
    const cursor = this.#cursorPositionM();
    if (!orbit || !cursor) return;

    // The OrbitControls wheel listener applies its dolly synchronously after
    // this event is published. Keep the pose from before that dolly so the
    // next tick can rebase the result from this interaction's hit point.
    this.#pendingZoom = {
      fromCamera: this.internalCamera.position.clone(),
      fromTarget: orbit.target.clone(),
      focusPoint: new Vector3(...cursor),
      surfaceHit: this.#cursorIsSurfaceHit,
    };
  }

  #initRotateTowardCursor(): void {
    this.engineService.pointerdown$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (event) => {
        if (!event || !this.rotateToCursor() || !this.#isRotateButton(event.button) || !this.isActive()) return;
        const cursor = this.#cursorPositionM();
        const orbit = this.orbitControls();
        if (!cursor || !orbit) return;
        this.#rotateLockHandoff = { fromTarget: orbit.target.clone(), toTarget: new Vector3(...cursor), elapsedS: 0 };
      },
    );
    this.engineService.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (deltaS) => this.#stepRotateLockHandoff(deltaS),
    );
  }

  #isRotateButton(button: number): boolean {
    return (button === 0 && this.leftMouseAction() === 'rotate') ||
      (button === 1 && this.middleMouseAction() === 'rotate') ||
      (button === 2 && this.rightMouseAction() === 'rotate');
  }

  #stepRotateLockHandoff(deltaS: number): void {
    const handoff = this.#rotateLockHandoff;
    const orbit = this.orbitControls();
    if (!handoff || !orbit || !this.isActive()) {
      this.#rotateLockHandoff = null;
      return;
    }
    handoff.elapsedS += deltaS;
    const durationS = this.rotateHandoffDurationS();
    const progress = durationS <= 0 ? 1 : Math.min(handoff.elapsedS / durationS, 1);
    orbit.target.lerpVectors(handoff.fromTarget, handoff.toTarget, easeOutCubic(progress));
    this.#lastDistanceToTargetM = this.internalCamera.position.distanceTo(orbit.target);
    if (progress >= 1) this.#rotateLockHandoff = null;
  }

  #initZoomAnchorCompensation(): void {
    this.engineService.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const orbit = this.orbitControls();
      if (!orbit || !this.isActive() || !this.zoomToCursor()) {
        this.#lastDistanceToTargetM = null;
        return;
      }

      const pendingZoom = this.#pendingZoom;
      if (pendingZoom) {
        this.#pendingZoom = null;
        this.#applyWheelZoomRebase(orbit, pendingZoom);
        this.#lastDistanceToTargetM = this.internalCamera.position.distanceTo(orbit.target);
        return;
      }

      const distanceM = this.internalCamera.position.distanceTo(orbit.target);
      const previousDistanceM = this.#lastDistanceToTargetM;
      this.#lastDistanceToTargetM = distanceM;
      if (previousDistanceM === null || previousDistanceM === 0) return;
      const ratio = distanceM / previousDistanceM;
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < ZOOM_RATIO_EPSILON) return;
      const cursor = this.#cursorPositionM();
      if (!cursor) return;
      this.#steerTargetTowards(orbit.target, new Vector3(...cursor), 1 - ratio);
    });
  }

  /**
   * Rebase one wheel interaction from its current hit instead of carrying an
   * old pivot forward. The invariant is that the current raycast hit, not a
   * historical invisible point, controls the next zoom step.
   */
  #applyWheelZoomRebase(
    orbit: AdvancedOrbitControls,
    pendingZoom: {
      readonly fromCamera: Vector3;
      readonly fromTarget: Vector3;
      readonly focusPoint: Vector3;
      readonly surfaceHit: boolean;
    },
  ): void {
    const fromTargetDistance = pendingZoom.fromCamera.distanceTo(pendingZoom.fromTarget);
    if (fromTargetDistance <= 0) return;

    const currentTargetDistance = this.internalCamera.position.distanceTo(pendingZoom.fromTarget);
    if (!Number.isFinite(currentTargetDistance)) return;

    const rawRatio = currentTargetDistance / fromTargetDistance;
    if (!Number.isFinite(rawRatio)) return;

    let ratio = rawRatio;
    if (pendingZoom.surfaceHit) {
      const hitDistance = pendingZoom.fromCamera.distanceTo(pendingZoom.focusPoint);
      const clearance = Math.max(0, this.surfaceClearanceM());
      if (hitDistance > 0 && Number.isFinite(hitDistance)) {
        ratio = Math.max(ratio, clearance / hitDistance);
      }
    }

    if (Math.abs(ratio - 1) >= ZOOM_RATIO_EPSILON) {
      // This construction keeps the camera on the same side of the hit as
      // the pre-dolly pose and scales its distance from the actual surface.
      orbit.target.copy(pendingZoom.fromTarget).lerp(pendingZoom.focusPoint, 1 - ratio);
      this.internalCamera.position.copy(pendingZoom.focusPoint)
        .addScaledVector(pendingZoom.fromCamera.clone().sub(pendingZoom.focusPoint), ratio);
    }

    // The next logarithmic wheel step must use the current surface distance,
    // never the distance to a stale orbit target.
    const zoomReferenceDistance = pendingZoom.surfaceHit
      ? this.internalCamera.position.distanceTo(pendingZoom.focusPoint)
      : this.internalCamera.position.distanceTo(orbit.target);
    orbit.zoomSpeed = Math.log(Math.max(0, zoomReferenceDistance) + 1);
  }

  /** Moves pivot and camera together so a cursor-focused dolly preserves the newly produced orbit geometry. */
  #steerTargetTowards(target: Vector3, focusPointM: Vector3, alpha: number): void {
    const previousTarget = target.clone();
    target.lerp(focusPointM, alpha);
    this.internalCamera.position.add(target.clone().sub(previousTarget));
  }
}
