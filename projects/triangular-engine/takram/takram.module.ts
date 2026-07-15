import { NgModule } from '@angular/core';
import { TakramCloudLayerComponent, TakramCloudsComponent } from './clouds';
import {
  TakramAerialPerspectiveComponent,
  TakramAtmosphereComponent,
  TakramSkyLightComponent,
  TakramSunLightComponent,
} from './atmosphere';

const components = [
  TakramAtmosphereComponent,
  TakramAerialPerspectiveComponent,
  TakramSkyLightComponent,
  TakramSunLightComponent,
  TakramCloudLayerComponent,
  TakramCloudsComponent,
] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class TakramModule {}
