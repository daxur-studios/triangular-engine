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
  Group,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Vector3,
  Vector3Like,
  Vector3Tuple,
} from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { combineLatest, of, Subscription, switchMap, takeUntil } from 'rxjs';
import { AdvancedOrbitControls, xyz } from '../../models';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EngineService } from '../../services';

@Component({
  selector: 'orbitControls',
  template: `<ng-content></ng-content> `,

  standalone: true,
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

  readonly target = input<xyz>();
  readonly cameraPosition = input<xyz>();
  /** Move both target and camera position by adding this vector to it */
  readonly moveBy = input<xyz>();

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
        this.orbitControls()?.target.set(...target);
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

          return this.engineService.tick$;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((delta) => {
        if (!delta) return;

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
    effect(
      () => {
        const isActive = this.isActive();
        if (isActive) {
          const orbit = new AdvancedOrbitControls(
            this.internalCamera,
            this.engineService.renderer.domElement
          );
          this.#makeOrbitControlsBetter(orbit);
          this.orbitControls.set(orbit);

          this.switchCameraTrigger.update((v) => (v || 0) + 1);
        } else {
          this.orbitControls()?.dispose();
          this.orbitControls.set(undefined);
          this.previousFollowPosition = undefined;
        }
      },
      { allowSignalWrites: true }
    );
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
      toObservable(this.follow),
      toObservable(this.isActive),
      this.engineService.tick$,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([orbitControls, followObject, isActive, delta]) => {
        if (!isActive || !orbitControls) return;
        if (!followObject) return;

        const currentPosition = followObject.position.clone();
        const deltaPosition = currentPosition.clone();
        // .sub(this.previousFollowPosition);

        if (this.previousFollowPosition) {
          deltaPosition.sub(this.previousFollowPosition);
        }

        // Apply delta movement to camera position and orbitControls target
        this.internalCamera.position.add(deltaPosition);
        orbitControls.target.add(deltaPosition);

        // Update previous position for next frame
        //this.previousFollowPosition.copy(currentPosition);
        this.previousFollowPosition = currentPosition.clone();

        // Update orbit controls
        orbitControls.update();
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
