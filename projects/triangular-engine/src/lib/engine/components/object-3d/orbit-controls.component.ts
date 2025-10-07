import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  CameraHelper,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Vector3,
  Vector3Like,
  Vector3Tuple,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, of, switchMap } from 'rxjs';
import { AdvancedOrbitControls } from '../../models';
import { EngineService } from '../../services';

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

  readonly internalCamera = new PerspectiveCamera();

  readonly debug = input<boolean | undefined>();
  readonly isActive = input<boolean | undefined>(true);

  /** Set to eg a timeStamp, so when this changes, it witches the engine's rendering camera to this orbit control's camera */
  readonly switchCameraTrigger = model<number>();

  readonly target = input<Vector3Tuple | Object3D>();
  readonly cameraPosition = input<Vector3Tuple>();
  /** Move both target and camera position by adding this vector to it */
  readonly moveBy = input<Vector3Tuple>();

  /** Follow this Object3D, both target and camera */
  readonly follow = input<Object3D>();

  readonly upVector = input<Vector3Tuple>();

  readonly orbitControls = signal<AdvancedOrbitControls | undefined>(undefined);

  constructor() {
    this.engineService.scene.add(this.internalCamera);
    this.internalCamera.position.set(0, 2, 5);

    this.#initDebug();

    // Update OrbitControls target
    this.#initTargetChanges();
    // Update OrbitControls camera position
    this.#initCameraPositionChanges();
    // Move both target and camera position by adding this vector to it
    this.#initMoveByChanges();

    this.#initFollow();
    this.#initIsActive();

    this.#initOrbitControlsUpdate();

    this.#initSwitchCameraChanges();

    this.#initUpVectorChanges();

    this.#initIsDraggingTransformControls();
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
    });

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
      if (target) {
        const position =
          target instanceof Object3D ? target.position.toArray() : target;
        this.orbitControls()?.target.set(...position);
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
        this.orbitControls()?.update();
        if (this.cameraHelper) {
          this.cameraHelper.update();
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
    this.internalCamera.removeFromParent();
    this.orbitControls()?.dispose();
  }

  #makeOrbitControlsBetter(orbit: OrbitControls) {
    orbit.enableDamping = true;
    //   this.controls.zoomSpeed = 100;
    const camera = orbit.object as PerspectiveCamera;
    camera.far = Number.MAX_SAFE_INTEGER;
    camera.updateProjectionMatrix();

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

  #initIsActive() {
    effect(() => {
      const isActive = this.isActive();
      if (isActive) {
        const orbit = new AdvancedOrbitControls(
          this.internalCamera,
          this.engineService.renderer.domElement,
        );
        this.#makeOrbitControlsBetter(orbit);
        this.orbitControls.set(orbit);

        this.switchCameraTrigger.update((v) => (v || 0) + 1);
      } else {
        this.orbitControls()?.dispose();
        this.orbitControls.set(undefined);
        this.previousFollowPosition = undefined;
      }
    });
  }

  cameraHelper: CameraHelper | undefined;

  #initDebug() {
    effect(() => {
      if (this.debug()) {
        this.cameraHelper = new CameraHelper(this.internalCamera);
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

  private previousFollowPosition: Vector3Like | undefined;

  #initFollow() {
    combineLatest([
      toObservable(this.orbitControls),
      toObservable(this.follow).pipe(
        distinctUntilChanged((a, b) => {
          const isSame = a === b;
          if (!isSame && a) {
            // follow has changed, ensure orbit control is re-centered for the new follow
            const orbitControls = this.orbitControls();
            if (!orbitControls) return false;

            orbitControls.target.set(...a.position.toArray());
          }

          return isSame;
        }),
      ),
      toObservable(this.isActive),
      this.engineService.postTick$,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([orbitControls, followObject, isActive, delta]) => {
        if (!isActive || !orbitControls) return;
        if (!followObject) return;

        const currentPosition = followObject.position.clone();

        // Compute how much the followed object moved this frame
        if (!this.previousFollowPosition) {
          this.previousFollowPosition = currentPosition.clone();
          return;
        }

        const deltaPosition = currentPosition
          .clone()
          .sub(this.previousFollowPosition as Vector3);

        // Apply delta to both target and camera so user input is preserved
        this.internalCamera.position.add(deltaPosition);
        orbitControls.target.add(deltaPosition);

        // Keep damping for smooth camera motion
        orbitControls.enableDamping = true;

        // Store for next frame
        this.previousFollowPosition = currentPosition.clone();

        // OrbitControls are updated in postTick update handler
      });
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
