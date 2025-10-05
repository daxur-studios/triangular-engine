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
    ]
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
        this.bufferGeometry.geometry().setFromPoints(curve.getPoints(count));
      }
    });
  }
}
