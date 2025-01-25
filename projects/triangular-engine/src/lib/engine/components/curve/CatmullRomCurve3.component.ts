import { Component, signal } from '@angular/core';
import { provideObject3DComponent } from '../object-3d';
import { CurveComponent } from './curve.component';
import { CatmullRomCurve3 } from 'three';

@Component({
  selector: 'catmullRomCurve3',
  template: `<ng-content></ng-content>`,
})
export class CatmullRomCurve3Component extends CurveComponent {
  override readonly curve = signal(new CatmullRomCurve3());
}
