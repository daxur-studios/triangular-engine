import { NgModule } from '@angular/core';

import { EnvironmentComponentsModule } from './components';
import { EnvironmentMaterialsModule } from './materials';

const importExport = [
  EnvironmentMaterialsModule,
  EnvironmentComponentsModule,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineEnvironmentModule {}
