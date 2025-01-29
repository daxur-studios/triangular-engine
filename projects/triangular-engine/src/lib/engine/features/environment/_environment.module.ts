import { NgModule, Type } from '@angular/core';
import { SkySphereComponent } from './sky-sphere.component';

import { SkyBoxComponent } from './components/sky-box.component';

import { EnvironmentMaterialsModule } from './materials';
import { EnvironmentComponentsModule } from './components';

const importExport: Type<any>[] = [
  EnvironmentMaterialsModule,
  EnvironmentComponentsModule,

  SkySphereComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineEnvironmentModule {}
