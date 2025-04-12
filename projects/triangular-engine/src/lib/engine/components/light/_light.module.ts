import { NgModule, Type } from '@angular/core';
import { AmbientLightComponent } from './ambient-light.component';
import { DirectionalLightComponent } from './directional-light.component';
import { PointLightComponent } from './point-light.component';

const importExport: Array<Type<any>> = [
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineLightModule {}
