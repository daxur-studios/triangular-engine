import { NgModule, Type } from '@angular/core';

import { EnvironmentMaterialsModule } from './materials';
import { EnvironmentComponentsModule } from './components';

const importExport: Type<any>[] = [
  EnvironmentMaterialsModule,
  EnvironmentComponentsModule,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineEnvironmentModule {}
