import { Component, input, signal } from '@angular/core';
import { provideObject3DComponent } from '../object-3d';
import { CurveComponent } from './curve.component';
import { CatmullRomCurve3, Vector3Tuple } from 'three';

// TODO: finish implementing this if needed?
@Component({
  selector: 'catmullRomCurve3',
  standalone: true,
  template: `<ng-content></ng-content>`,
})
export class CatmullRomCurve3Component extends CurveComponent {
  override readonly curve = signal(new CatmullRomCurve3());

  readonly points = input.required<Vector3Tuple[]>();
  readonly numberOfPoints = input.required<number>();

  constructor() {
    super();
  }
}
