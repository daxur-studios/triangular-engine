import { NgModule } from '@angular/core';
import { OceanComponent } from './ocean.component';
import { SkyBoxComponent } from './sky-box.component';

const importExport = [SkyBoxComponent, OceanComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EnvironmentComponentsModule {}
