import { NgModule, Type } from '@angular/core';
import { SkyBoxComponent } from './sky-box.component';
import { OceanComponent } from './ocean.component';

const importExport: Type<any>[] = [SkyBoxComponent, OceanComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EnvironmentComponentsModule {}
