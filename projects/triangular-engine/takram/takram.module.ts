import { NgModule } from '@angular/core';
import {
  TakramCloudLayerComponent,
  TakramCloudsComponent,
  TakramCylinderCloudShellComponent,
} from './clouds';
import {
  TakramAerialPerspectiveComponent,
  TakramAtmosphereComponent,
  TakramCylinderAtmosphereComponent,
  TakramSkyLightComponent,
  TakramSunLightComponent,
} from './atmosphere';

const components = [
  TakramAtmosphereComponent,
  TakramAerialPerspectiveComponent,
  TakramCylinderAtmosphereComponent,
  TakramSkyLightComponent,
  TakramSunLightComponent,
  TakramCloudLayerComponent,
  TakramCylinderCloudShellComponent,
  TakramCloudsComponent,
] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class TakramModule {}
