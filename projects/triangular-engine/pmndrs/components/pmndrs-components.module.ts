import { NgModule } from '@angular/core';
import { BillboardComponent } from './billboard/billboard.component';
import { SparklesComponent } from './sparkles/sparkles.component';

const importExport = [BillboardComponent, SparklesComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class PmndrsComponentsModule {}
