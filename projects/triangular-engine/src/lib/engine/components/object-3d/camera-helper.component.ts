import { Component, effect, input, signal } from '@angular/core';

import { Camera, CameraHelper } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * Example:
 * ```html
 * <cameraHelper [camera]="perspectiveCamera" />
 * ```
 */
@Component({
  selector: 'cameraHelper',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(CameraHelperComponent)],
})
export class CameraHelperComponent extends Object3DComponent {
  public override emoji = '📹';

  readonly camera = input.required<Camera>();

  override object3D = signal(new CameraHelper(new Camera()));
  get cameraHelper() {
    return this.object3D;
  }

  private previousCameraHelper: CameraHelper | undefined = this.cameraHelper();

  constructor() {
    super();

    effect(() => {
      const prevCameraHelper = this.previousCameraHelper;
      if (prevCameraHelper) {
        prevCameraHelper.removeFromParent();
        prevCameraHelper.dispose();
      }

      const camera = this.camera();
      if (!camera) return;

      const cameraHelper = new CameraHelper(camera);

      this.object3D.set(cameraHelper);

      this.previousCameraHelper = cameraHelper;
    });

    this.#initTickUpdate();
  }

  #initTickUpdate() {
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaSeconds) => {
        if (this.cameraHelper) {
          this.cameraHelper().update();
        }
      });
  }

  override ngOnDestroy() {
    this.object3D().dispose();
    this.previousCameraHelper?.dispose();
    super.ngOnDestroy();
  }
}
