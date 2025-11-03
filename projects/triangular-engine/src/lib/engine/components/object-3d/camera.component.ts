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
  Camera,
  CameraHelper,
  MathUtils,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  Vector3Like,
  Vector3Tuple,
} from 'three';

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, of, switchMap } from 'rxjs';
import { EngineService } from '../../services';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
@Component({
  selector: 'camera',
  template: `<ng-content></ng-content> `,
  imports: [],
  providers: [provideObject3DComponent(CameraComponent)],
})
export class CameraComponent extends Object3DComponent implements OnDestroy {
  readonly camera = signal(new PerspectiveCamera());
  override object3D = this.camera;

  readonly debug = input<boolean | undefined>();
  readonly isActive = model<boolean | undefined>(true);

  /** Camera frustum far plane. @remarks — Must be greater than the current value of .near plane. @remarks — Expects a Float @defaultValue — 2000 */
  readonly far = input<number>();

  /** Set to eg a timeStamp, so when this changes, it witches the engine's rendering camera to this component's camera */
  readonly switchCameraTrigger = model<number>();

  /**
   * The point in 3D space that the camera is looking at
   */
  readonly lookAt = model<Vector3Tuple | Object3D>([0, 0, 0]);

  /** Move both target and camera position by adding this vector to it */
  readonly moveBy = input<Vector3Tuple>();

  /** Follow this Object3D, both target and camera */
  readonly follow = input<Object3D>();

  readonly upVector = input<Vector3Tuple>();

  constructor() {
    super();

    this.#initDebug();

    this.#initLookAtChanges();

    // this.#initCameraPositionChanges();
    // Move both target and camera position by adding this vector to it
    this.#initMoveByChanges();

    //this.#initFollow();
    this.#initIsActive();

    this.#initTickUpdate();

    this.#initSwitchCameraChanges();
    this.#initFarClippingPlaneChanges();
  }

  #initFarClippingPlaneChanges() {
    effect(() => {
      const far = this.far();
      const camera = this.camera();
      if (far) {
        camera.far = far;
        camera.updateProjectionMatrix();
        if (this.cameraHelper) {
          this.cameraHelper.update();
        }
      }
    });
  }

  #initLookAtChanges() {
    effect(() => {
      const lookAt = this.lookAt();
      const camera = this.camera();
      const position = this.position();
      if (lookAt && position) {
        const lookAtVector = Array.isArray(lookAt)
          ? lookAt
          : lookAt.position.toArray();
        camera.lookAt(...lookAtVector);
      }
    });
  }
  // #initCameraPositionChanges() {
  //   effect(() => {
  //     const cameraPosition = this.cameraPosition();
  //     const camera = this.camera();
  //     if (cameraPosition) {
  //       camera.position.set(...cameraPosition);
  //     }
  //   });
  // }
  #initMoveByChanges() {
    effect(() => {
      const moveBy = this.moveBy();
      const camera = this.camera();
      if (moveBy) {
        camera.position.add(new Vector3(...moveBy));
        camera.lookAt(...moveBy);
      }
    });
  }
  #initTickUpdate() {
    toObservable(this.isActive)
      .pipe(
        switchMap((isActive) => {
          if (!isActive) return of(undefined);

          return this.engineService.tick$;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((delta) => {
        if (!delta) return;

        if (this.cameraHelper) {
          this.cameraHelper.update();
        }
      });
  }

  #initSwitchCameraChanges() {
    effect(() => {
      const trigger = this.switchCameraTrigger();
      const camera = this.camera();
      if (trigger) {
        this.engineService.switchCamera(camera);
      }
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.camera().removeFromParent();
  }

  #makeCameraBetter(camera: PerspectiveCamera) {
    camera.updateProjectionMatrix();
  }

  #initIsActive() {
    effect(() => {
      const isActive = this.isActive();
      const camera = this.camera();
      if (isActive && camera instanceof PerspectiveCamera) {
        this.#makeCameraBetter(camera);

        this.switchCameraTrigger.update((v) => (v || 0) + 1);
      } else {
        this.previousFollowPosition = undefined;
      }
    });
  }

  cameraHelper: CameraHelper | undefined;

  #initDebug() {
    effect(() => {
      const camera = this.camera();
      if (this.debug()) {
        this.cameraHelper = new CameraHelper(camera);
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
}
