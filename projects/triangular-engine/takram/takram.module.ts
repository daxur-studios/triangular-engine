import { NgModule } from '@angular/core';
import {
  TakramCloudLayerComponent,
  TakramCloudsComponent,
} from './clouds';

const components = [TakramCloudLayerComponent, TakramCloudsComponent] as const;

@NgModule({
  imports: [...components],
  exports: [...components],
})
export class TakramModule {}
