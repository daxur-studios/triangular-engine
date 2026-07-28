import { Float32BufferAttribute } from 'three';
import {
  Component,
  effect,
  inject,
  input,
  model,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  GroupComponent,
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d';
import {
  Curve,
  Group,
  Object3D,
  Object3DEventMap,
  Vector2,
  Vector3,
} from 'three';
import { BufferGeometryComponent } from '../geometry';

@Component({
  selector: 'curve',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [
    // provideObject3DComponent(CurveComponent),
  ],
})
export abstract class CurveComponent {
  //#region Injected Dependencies
  readonly parent = inject(Object3DComponent);
  readonly bufferGeometry = inject(BufferGeometryComponent, { optional: true });
  //#endregion

  abstract curve: WritableSignal<Curve<any>>;

  readonly pointsCount = model<number>(50);

  readonly curveUpdatedTrigger = signal(0);

  constructor() {
    this.#initSetBufferGeometry();
  }

  #initSetBufferGeometry() {
    effect(() => {
      const curve = this.curve();
      const count = this.pointsCount();
      const curveUpdatedTrigger = this.curveUpdatedTrigger();

      if (this.bufferGeometry) {
        const geometry = this.bufferGeometry.geometry();
        const points = curve.getPoints(count);
        const positionAttr = geometry.getAttribute('position');

        if (!positionAttr || positionAttr.count < points.length) {
          const headroom = Math.min(Math.max(64, Math.ceil(points.length * 0.5)), 10000);
          const capacity = points.length + headroom;
          const newAttr = new Float32BufferAttribute(capacity * 3, 3);
          for (let i = 0; i < points.length; i++) {
            newAttr.setXYZ(i, points[i].x, points[i].y, points[i].z);
          }
          geometry.setAttribute('position', newAttr);
        } else {
          for (let i = 0; i < points.length; i++) {
            positionAttr.setXYZ(i, points[i].x, points[i].y, points[i].z);
          }
          positionAttr.needsUpdate = true;
        }

        geometry.setDrawRange(0, points.length);
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
      }
    });
  }
}
