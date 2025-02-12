import { NgModule, Type } from '@angular/core';
import { Css2dComponent } from './css-2d.component';
import { Css3dComponent } from './css-3d.component';

const importExport: Array<Type<any>> = [Css2dComponent, Css3dComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineCssComponentsModule {}
