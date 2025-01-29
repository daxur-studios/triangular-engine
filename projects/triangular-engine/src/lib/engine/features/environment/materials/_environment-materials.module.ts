import { NgModule, Type } from '@angular/core';
import { SkyBoxMaterialComponent } from './sky-box-material.component';

const importExport: Type<any>[] = [SkyBoxMaterialComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EnvironmentMaterialsModule {}
