import { NgModule } from '@angular/core';
import { SkyBoxMaterialComponent } from './sky-box-material.component';

const importExport = [SkyBoxMaterialComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EnvironmentMaterialsModule {}
