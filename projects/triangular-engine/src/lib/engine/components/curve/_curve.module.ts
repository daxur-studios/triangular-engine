import { NgModule, Type } from '@angular/core';
import { CurveComponent } from './curve.component';
import { EllipseCurveComponent } from './ellipse-curve.component';
import { LineComponent } from './line.component';

const importExport: Type<any>[] = [EllipseCurveComponent, LineComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineCurveModule {}
