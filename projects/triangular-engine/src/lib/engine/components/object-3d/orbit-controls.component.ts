import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import {
  Box3,
  CameraHelper,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Sphere,
  Vector3,
  Vector3Like,
  Vector3Tuple,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, of, switchMap } from 'rxjs';
import { AdvancedOrbitControls } from '../../models';
import { EngineService, MultiViewportService } from '../../services';
import { Object3DComponent } from './object-3d.component';

/**
 * - Use input `follow` to follow an Object3D.
 * - Use input `cameraPosition` to set the camera position.
 * - `target` is the target of the camera.
 */
@Component({
  selector: 'orbitControls',
  template: `<ng-content></ng-content> `,
  imports: [],
})
export class OrbitControlsComponent implements OnDestroy {
  readonly engineService = inject(EngineService);
  readonly destroyRef = inject(DestroyRef);
  readonly multiViewportService = inject(MultiViewportService, { optional: true });

  readonly internalCamera = new PerspectiveCamera();

  readonly debug = input<boolean | undefined>();
  readonly isActive = input<boolean | undefined>(true);

  /** Render this camera to a viewport rectangle: [x, y, width, height] normalized (0-1). Origin is bottom-left. */
  readonly viewport = input<[x: number, y: number, width: number, height: number] | undefined>();

  /** Set to eg a timeStamp, so when this changes, it witches the engine's rendering camera to this orbit control's camera */
  readonly switchCameraTrigger = model<number>();

  readonly target = input<Vector3Tuple | Object3D>();
  readonly cameraPosition = input<Vector3Tuple>();
  readonly fov = input(50);
  readonly near = input(0.1);
  readonly far = input(Number.MAX_SAFE_INTEGER);
  /** Move both target and camera position by adding this vector to it */
  readonly moveBy = input<Vector3Tuple>();

  /** Follow this Object3D, both target and camera */
  readonly follow = input<Object3D>();

  readonly upVector = input<Vector3Tuple | Readonly<Vector3Tuple>>();

  readonly orbitControls = signal<AdvancedOrbitControls | undefined>(undefined);
  readonly orbitControls$ = toObservable(this.orbitControls);

  /** Distance threshold in meters from follow target to consider camera panned away (defaults to 5.0m). */
  readonly panThresholdM = input(5.0);

  /** Emits true when camera target pans away beyond panThresholdM, false when recentered. */
  readonly pannedAwayChange = output<boolean>();

  /** True when camera target has panned away from the follow object's position. */
  readonly isPannedAway = signal(false);

  constructor() {
    const controlName = this.constructor.name.replace('Component', '');
    this.internalCamera.name = Object3DComponent.nextInstanceName(`${controlName}Camera`);
    this.engineService.scene.add(this.internalCamera);
    this.internalCamera.position.set(0, 2, 5);

    this.#initDebug();

    // Update OrbitControls target
    this.#initTargetChanges();
    // Update OrbitControls camera position
    this.#initCameraPositionChanges();
    this.#initCameraProjectionChanges();
    // Move both target and camera position by adding this vector to it
    this.#initMoveByChanges();

    this.#initFollow();
    this.#initIsActive();

    this.#initOrbitControlsUpdate();

    this.#initSwitchCameraChanges();

    this.#initUpVectorChanges();

    this.#initIsDraggingTransformControls();

    this.#initViewportRegistration();
  }

  #initViewportRegistration() {
    effect(() => {
      const vp = this.viewport();
      const cam = this.internalCamera;
      if (this.multiViewportService) {
        if (vp) {
          this.multiViewportService.registerViewportCamera(cam, vp);
        } else {
          this.multiViewportService.unregisterViewportCamera(cam);
        }
      }
    });
  }

  #initIsDraggingTransformControls() {
    this.engineService.isDraggingTransformControls$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isDragging) => {
        const orbit = this.orbitControls();
        if (!orbit) return;

        if (isDragging) {
          orbit.enabled = false;
        } else {
          orbit.enabled = true;
        }
      });
  }

  #initUpVectorChanges() {
    effect(() => {
      const upVector = this.upVector();
      const orbit = this.orbitControls();
      if (upVector && orbit) {
        orbit.setUpVector(new Vector3(...upVector));
        //orbit.object.up.set(...upVector);
        // this.internalCamera.up.set(...upVector);
      }
    });
  }

  #initTargetChanges() {
    effect(() => {
      const target = this.target();
      const orbit = this.orbitControls();
      if (target && orbit) {
        if (Array.isArray(target)) {
          orbit.target.set(...target);
        } else {
          orbit.target.copy(target.position);
        }
      }
    });
  }

  #initCameraPositionChanges() {
    effect(() => {
      const cameraPosition = this.cameraPosition();
      if (cameraPosition) {
        this.internalCamera.position.set(...cameraPosition);
      }
    });
  }
  #initCameraProjectionChanges() {
    effect(() => {
      this.internalCamera.fov = this.fov();
      this.internalCamera.near = this.near();
      this.internalCamera.far = this.far();
      this.internalCamera.updateProjectionMatrix();
    });
  }
  #initMoveByChanges() {
    effect(() => {
      const moveBy = this.moveBy();
      if (moveBy) {
        this.orbitControls()?.target.add(new Vector3(...moveBy));
        this.internalCamera.position.add(new Vector3(...moveBy));
      }
    });
  }
  #initOrbitControlsUpdate() {
    toObservable(this.isActive)
      .pipe(
        switchMap((isActive) => {
          if (!isActive) return of(undefined);

          return this.engineService.postTick$;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const orbit = this.orbitControls();
        orbit?.update();
        if (this.cameraHelper) {
          this.cameraHelper.update();
        }

        const followObject = this.follow();
        if (orbit && followObject) {
          const followWorldPos = new Vector3();
          followObject.getWorldPosition(followWorldPos);
          const dist = orbit.target.distanceTo(followWorldPos);
          const isPanned = dist > this.panThresholdM();
          if (this.isPannedAway() !== isPanned) {
            this.isPannedAway.set(isPanned);
            this.pannedAwayChange.emit(isPanned);
          }
        } else if (this.isPannedAway()) {
          this.isPannedAway.set(false);
          this.pannedAwayChange.emit(false);
        }
      });
  }
  #initSwitchCameraChanges() {
    effect(() => {
      const trigger = this.switchCameraTrigger();
      if (trigger) {
        this.engineService.switchCamera(this.internalCamera);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.multiViewportService) {
      this.multiViewportService.unregisterViewportCamera(this.internalCamera);
    }
    this.#teardownViewportOverlay();
    this.internalCamera.removeFromParent();
    this.orbitControls()?.dispose();
  }

  #makeOrbitControlsBetter(orbit: OrbitControls) {
    orbit.enableDamping = true;
    //   this.controls.zoomSpeed = 100;
    const camera = orbit.object as PerspectiveCamera;
    orbit.addEventListener('change', () => {
      if (!this.isActive()) return;

      const distance = orbit.object.position.distanceTo(orbit.target);

      // Base zoom speed
      const baseZoomSpeed = 1;

      // Calculate dynamic zoom speed based on distance
      // Using a logarithmic scale to ensure it increases at a decreasing rate
      // Adding 1 to avoid logarithm of zero and ensure a minimum speed multiplier
      const zoomSpeedMultiplier = Math.log(distance + 1);

      // Adjust zoom speed dynamically
      orbit.zoomSpeed = baseZoomSpeed * zoomSpeedMultiplier;

      // // Increase how far the camera sees before it clips objects.
      // camera.far = distance
      // camera.updateProjectionMatrix();

      // Do not allow 90 degree tilt
      orbit.minPolarAngle = MathUtils.degToRad(0.01); // Prevent looking directly upward
      orbit.maxPolarAngle = MathUtils.degToRad(179.99); // Prevent looking directly downward
    });
  }

  /**
   * Tracks the live orbit instance outside the `orbitControls` signal so
   * `#initIsActive`'s effect never reads that signal itself — reading it
   * there while also writing a fresh (non-equal) instance later in the same
   * run would make the effect depend on its own write, re-triggering itself
   * every time isActive/viewport are truthy: dispose → create → write →
   * re-run → dispose → create..., forever, before anything can render.
   */
  #currentOrbit: AdvancedOrbitControls | undefined;

  #initIsActive() {
    effect(() => {
      const isActive = this.isActive();
      const vp = this.viewport();

      this.#currentOrbit?.dispose();
      this.#currentOrbit = undefined;
      this.orbitControls.set(undefined);
      delete this.internalCamera.userData['sceneTestOrbitControls'];
      this.#teardownViewportOverlay();

      if (!isActive) return;

      const domElement = vp
        ? this.#createViewportOverlay(vp)
        : this.engineService.renderer.domElement;

      const orbit = new AdvancedOrbitControls(this.internalCamera, domElement);
      this.#makeOrbitControlsBetter(orbit);
      this.#currentOrbit = orbit;
      // Opt-in test adapters can coordinate camera framing with the live
      // controls without reaching into Angular component instances.
      this.internalCamera.userData['sceneTestOrbitControls'] = orbit;
      this.orbitControls.set(orbit);

      this.switchCameraTrigger.update((v) => (v || 0) + 1);
    });
  }

  #viewportOverlayEl: HTMLDivElement | undefined;

  /**
   * Gives this instance's OrbitControls its own DOM element scoped to its
   * viewport rectangle, instead of the shared full-canvas domElement. This
   * lets each viewport orbit independently via native browser hit-testing —
   * no custom pointer routing or click-to-activate state needed, and no risk
   * of two OrbitControls instances racing over the same pointerdown event.
   */
  #createViewportOverlay(
    viewport: [x: number, y: number, width: number, height: number],
  ): HTMLElement {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.pointerEvents = 'auto';
    div.style.touchAction = 'none';

    const [x, y, w, h] = viewport;
    div.style.left = `${x * 100}%`;
    div.style.width = `${w * 100}%`;
    // Three.js viewport origin is bottom-left; CSS `top` is measured from
    // the top, so the y-axis needs flipping.
    div.style.top = `${(1 - y - h) * 100}%`;
    div.style.height = `${h * 100}%`;

    this.#viewportOverlayEl = div;
    this.#attachViewportOverlay(div);
    return div;
  }

  /**
   * SceneComponent appends the canvas to its wrapper in ngAfterViewInit,
   * which may not have run yet when this effect first fires. Retry until
   * the canvas has a connected parent to append this overlay next to.
   */
  #attachViewportOverlay(div: HTMLDivElement): void {
    if (this.#viewportOverlayEl !== div) return; // torn down or replaced since

    const container = this.engineService.canvas.parentElement;
    if (container && container.isConnected) {
      container.appendChild(div);
    } else {
      requestAnimationFrame(() => this.#attachViewportOverlay(div));
    }
  }

  #teardownViewportOverlay(): void {
    this.#viewportOverlayEl?.remove();
    this.#viewportOverlayEl = undefined;
  }

  cameraHelper: CameraHelper | undefined;

  #initDebug() {
    effect(() => {
      if (this.debug()) {
        this.cameraHelper = new CameraHelper(this.internalCamera);
        this.cameraHelper.name = Object3DComponent.nextInstanceName(
          `${this.constructor.name.replace('Component', '')}DebugHelper`,
        );
        this.engineService.scene.add(this.cameraHelper);
      } else {
        if (this.cameraHelper) {
          this.cameraHelper.removeFromParent();
          this.cameraHelper.dispose();
          this.cameraHelper = undefined;
        }
      }
    });
  }

  private previousFollowPosition: Vector3 | undefined;
  /** True when the caller supplied this frame's authoritative follow position. */
  private followPositionPushedSincePostTick = false;

  #initFollow() {
    effect(() => {
      const followObject = this.follow();
      const orbit = this.orbitControls();
      this.previousFollowPosition = undefined;
      this.followPositionPushedSincePostTick = false;
      if (followObject && orbit) {
        followObject.updateMatrixWorld(true);
        const worldPos = new Vector3();
        followObject.getWorldPosition(worldPos);

        // Automatically adjust camera zoom/distance to fit the object
        const direction = new Vector3();
        direction.subVectors(this.internalCamera.position, orbit.target).normalize();
        if (direction.lengthSq() === 0) {
          direction.set(0, 1, 2).normalize();
        }

        const box = new Box3().setFromObject(followObject);
        const sphere = new Sphere();
        box.getBoundingSphere(sphere);
        const radius = Math.max(sphere.radius, 0.02);

        // Keep current zoom distance, but clamp to fit target size
        const currentDistance = this.internalCamera.position.distanceTo(orbit.target);
        const minDistance = radius * 3.5;
        const targetDistance = Math.max(currentDistance, minDistance);

        orbit.target.copy(worldPos);
        this.previousFollowPosition = worldPos;

        this.internalCamera.position.copy(worldPos).addScaledVector(direction, targetDistance);
      }
    });

    combineLatest([
      toObservable(this.orbitControls),
      toObservable(this.isActive),
      this.engineService.postTick$,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([orbitControls, isActive]) => {
        const authoritativePositionWasPushed =
          this.followPositionPushedSincePostTick;
        this.followPositionPushedSincePostTick = false;
        if (!isActive || !orbitControls) return;
        // Angular may not have committed the matching Object3D input yet.
        // Reading it now would undo the authoritative delta already applied
        // by updateFollowPosition() earlier in this engine frame.
        if (authoritativePositionWasPushed) return;
        const followObject = this.follow();
        if (!followObject) return;

        followObject.updateMatrixWorld(true);
        const currentWorldPos = new Vector3();
        followObject.getWorldPosition(currentWorldPos);

        // Compute how much the followed object moved this frame
        if (!this.previousFollowPosition) {
          this.previousFollowPosition = currentWorldPos.clone();
          return;
        }

        const deltaPosition = currentWorldPos
          .clone()
          .sub(this.previousFollowPosition);

        // Apply delta to both target and camera so user input (pan/zoom/
        // rotate) is preserved — unlike snapping target to the object's
        // absolute position every frame, this only adds the object's own
        // motion, so a manual pan away from the vessel persists instead of
        // being overridden the next frame.
        this.internalCamera.position.add(deltaPosition);
        orbitControls.target.add(deltaPosition);

        orbitControls.enableDamping = true;

        this.previousFollowPosition = currentWorldPos.clone();
      });
  }

  /**
   * Advances the follow-delta tracker using an authoritative world-space
   * position supplied by the caller, instead of reading `follow()`'s
   * Object3D back out via `getWorldPosition()`. Use this when the caller
   * already computes the followed object's corrected position itself (e.g.
   * once per physics substep, in the same synchronous step as a
   * floating-origin rebase) — that avoids a race against Angular's
   * effect-driven mesh position update, which runs asynchronously relative
   * to the physics tick and can still be stale when `postTick$`'s automatic
   * tracking below reads it, especially when several rebases land inside a
   * single rendered frame under high time-warp.
   *
   * Safe to call every frame alongside automatic `postTick$` tracking. A
   * push suppresses Object3D readback for that frame, because Angular may
   * not have committed the matching template-bound transform yet.
   */
  updateFollowPosition(worldPos: Vector3Tuple): void {
    const orbit = this.orbitControls();
    if (!orbit) return;
    this.followPositionPushedSincePostTick = true;

    const currentWorldPos = new Vector3(...worldPos);

    if (!this.previousFollowPosition) {
      this.previousFollowPosition = currentWorldPos.clone();
      return;
    }

    const deltaPosition = currentWorldPos.clone().sub(this.previousFollowPosition);
    this.internalCamera.position.add(deltaPosition);
    orbit.target.add(deltaPosition);

    this.previousFollowPosition = currentWorldPos.clone();
  }

  /**
   * Re-centers the target on whatever `follow` currently points at and
   * pulls the camera back to `offset` from it — the fix for "I panned/
   * zoomed away and can't find my vessel again": panning moves `target`
   * itself, so afterward `#initFollow`'s per-frame delta-add keeps it
   * offset by the same drifted amount forever instead of correcting back
   * toward the followed object. A plain re-lock (no offset) only fixes the
   * target; passing `offset` also resets zoom/angle to a known-good view.
   */
  recenterOnFollow(offset?: Vector3Tuple): void {
    const orbit = this.orbitControls();
    const followObject = this.follow();
    if (!orbit || !followObject) return;

    const worldPos = new Vector3();
    followObject.getWorldPosition(worldPos);
    orbit.target.copy(worldPos);
    if (offset) {
      this.internalCamera.position.copy(worldPos).add(new Vector3(...offset));
    }
    this.previousFollowPosition = worldPos.clone();
    orbit.update();
    if (this.isPannedAway()) {
      this.isPannedAway.set(false);
      this.pannedAwayChange.emit(false);
    }
  }

  /**
   * Shift the camera, its target, and the follow-delta tracker into the new
   * coordinate frame after a floating-origin rebase, which moves every
   * physics-tracked body's local position by `-delta` (see `PhysicsOrigin`/
   * `PhysicsWorld` in the host app). `previousFollowPosition` must be
   * corrected (not discarded) here: `#initFollow` diffs it against the
   * followed object's current position every postTick, and nulling it
   * requires two consecutive rebase-free frames to resume tracking — rare
   * enough to not matter at 1x, but at high rails warp rebases can fire on
   * nearly every frame, which stalled tracking almost entirely.
   */
  onFloatingOriginRebase(delta: Vector3Tuple) {
    const orbit = this.orbitControls();
    if (!orbit) return;

    const deltaVector = new Vector3(...delta);
    orbit.target.sub(deltaVector);
    this.internalCamera.position.sub(deltaVector);
    this.previousFollowPosition?.sub(deltaVector);
    orbit.update();
  }

  public getForwardsVector(): Vector3 {
    const orbit = this.orbitControls();
    if (!orbit) return new Vector3(0, 0, 0);

    const target = orbit.target;
    const position = orbit.object.position;

    const direction = new Vector3();
    direction.subVectors(target, position).normalize();

    return direction;
  }
}
