import { NgModule } from '@angular/core';

import { AutoRotateDirective } from './auto-rotate.directive';

const importExport = [
  AutoRotateDirective,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineDirectiveModule {}
