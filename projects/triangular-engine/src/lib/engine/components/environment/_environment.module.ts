import { NgModule, Type } from '@angular/core';
import { SkySphereComponent } from './sky-sphere/sky-sphere.component';

const importExport: Type<any>[] = [SkySphereComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineEnvironmentModule {} 