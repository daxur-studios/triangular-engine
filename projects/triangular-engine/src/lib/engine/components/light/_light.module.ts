import { NgModule } from '@angular/core';
import { AmbientLightComponent } from './ambient-light.component';
import { DirectionalLightComponent } from './directional-light.component';
import { PointLightComponent } from './point-light.component';

const importExport = [
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineLightModule {}
