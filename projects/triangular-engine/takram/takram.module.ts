import { NgModule } from '@angular/core';
import {
  TakramCloudLayerComponent,
  TakramCloudsComponent,
} from './clouds';
import {
  TakramAerialPerspectiveComponent,
  TakramAtmosphereComponent,
} from './atmosphere';

const components = [
  TakramAtmosphereComponent,
  TakramAerialPerspectiveComponent,
  TakramCloudLayerComponent,
  TakramCloudsComponent,
] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class TakramModule {}
