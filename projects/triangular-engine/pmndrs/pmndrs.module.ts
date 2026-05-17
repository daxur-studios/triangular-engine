import { NgModule } from '@angular/core';
import { PmndrsComponentsModule } from './components';

const importExport = [PmndrsComponentsModule] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class PmndrsModule {}
