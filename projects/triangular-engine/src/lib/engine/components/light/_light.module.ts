import { NgModule } from '@angular/core';
import { AmbientLightComponent } from './ambient-light.component';
import { DirectionalLightComponent } from './directional-light.component';
import { PointLightComponent } from './point-light.component';
import { CsmComponent, CsmReceiverDirective } from './csm';

const importExport = [
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  CsmComponent,
  CsmReceiverDirective,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineLightModule {}
