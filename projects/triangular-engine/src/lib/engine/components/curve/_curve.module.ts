import { NgModule } from '@angular/core';
import { EllipseCurveComponent } from './ellipse-curve.component';
import { LineComponent } from './line.component';

const importExport = [EllipseCurveComponent, LineComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineCurveModule {}
