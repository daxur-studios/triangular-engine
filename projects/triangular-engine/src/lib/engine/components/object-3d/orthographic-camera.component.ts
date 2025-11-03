import {
  Component,
  effect,
  input,
  model,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  Camera,
  CameraHelper,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  Vector3Like,
  Vector3Tuple,
} from 'three';

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
@Component({
  selector: 'orthographicCamera',
  template: `<ng-content></ng-content> `,
  imports: [],
  providers: [provideObject3DComponent(OrthographicCameraComponent)],
})
export class OrthographicCameraComponent
  extends Object3DComponent
  implements OnDestroy
{
  readonly camera = signal<OrthographicCamera>(new OrthographicCamera());
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

  /** Left frustum plane. @remarks — Expects a Float @defaultValue — -1 */
  readonly left = input<number>();

  /** Right frustum plane. @remarks — Expects a Float @defaultValue — 1 */
  readonly right = input<number>();

  /** Top frustum plane. @remarks — Expects a Float @defaultValue — 1 */
  readonly top = input<number>();

  /** Bottom frustum plane. @remarks — Expects a Float @defaultValue — -1 */
  readonly bottom = input<number>();

  /** Camera zoom factor. @remarks — Expects a Float @defaultValue — 1 */
  readonly zoom = input<number>();

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
    this.#initOrthographicFrustumChanges();
    this.#initZoomChanges();
  }

  #initFarClippingPlaneChanges() {
    effect(() => {
      const far = this.far();
      const camera = this.camera();
      if (far && camera instanceof OrthographicCamera) {
        camera.far = far;
        camera.updateProjectionMatrix();
        if (this.cameraHelper) {
          this.cameraHelper.update();
        }
      }
    });
  }

  #initOrthographicFrustumChanges() {
    effect(() => {
      const left = this.left();
      const right = this.right();
      const top = this.top();
      const bottom = this.bottom();
      const camera = this.camera();

      if (camera instanceof OrthographicCamera) {
        if (left !== undefined) camera.left = left;
        if (right !== undefined) camera.right = right;
        if (top !== undefined) camera.top = top;
        if (bottom !== undefined) camera.bottom = bottom;

        if (
          left !== undefined ||
          right !== undefined ||
          top !== undefined ||
          bottom !== undefined
        ) {
          camera.updateProjectionMatrix();
          if (this.cameraHelper) {
            this.cameraHelper.update();
          }
        }
      }
    });
  }

  #initZoomChanges() {
    effect(() => {
      const zoom = this.zoom();
      const camera = this.camera();
      if (zoom && camera instanceof OrthographicCamera) {
        camera.zoom = zoom;
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

  #makeCameraBetter(camera: OrthographicCamera) {
    camera.updateProjectionMatrix();
    return;
    camera.far = Number.MAX_SAFE_INTEGER;
  }

  #initIsActive() {
    effect(() => {
      const isActive = this.isActive();
      const camera = this.camera();
      if (isActive && camera instanceof OrthographicCamera) {
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

  // #initFollow() {
  //   combineLatest([
  //     toObservable(this.camera),
  //     toObservable(this.follow),
  //     toObservable(this.lookAt),
  //     toObservable(this.isActive),
  //     this.engineService.tick$,
  //   ])
  //     .pipe(takeUntilDestroyed(this.destroyRef))
  //     .subscribe(([camera, lookAt, isActive, delta]) => {
  //       if (!isActive || !camera) return;
  //       if (!lookAt) return;

  //       const currentPosition = lookAt.position.clone();
  //       const deltaPosition = currentPosition.clone();
  //       // .sub(this.previousFollowPosition);

  //       if (this.previousFollowPosition) {
  //         deltaPosition.sub(this.previousFollowPosition);
  //       }

  //       // Apply delta movement to camera position and orbitControls target
  //       camera.position.add(deltaPosition);

  //       this.lookAt.set([
  //         target[0] + deltaPosition.x,
  //         target[1] + deltaPosition.y,
  //         target[2] + deltaPosition.z,
  //       ]);
  //       camera.lookAt(...lookAt);

  //       // Update previous position for next frame
  //       //this.previousFollowPosition.copy(currentPosition);
  //       this.previousFollowPosition = currentPosition.clone();
  //     });
  // }
}
