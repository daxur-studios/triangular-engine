import { NgModule, Type } from '@angular/core';
import { SkyBoxComponent } from './sky-box.component';

const importExport: Type<any>[] = [SkyBoxComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EnvironmentComponentsModule {}
