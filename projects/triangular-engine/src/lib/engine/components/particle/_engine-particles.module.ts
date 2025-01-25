import { NgModule, Type } from '@angular/core';
import { PointsComponent } from './points.component';
import { ParticleSystemComponent } from './particle-system.component';

const importExport: Type<any>[] = [PointsComponent, ParticleSystemComponent];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineParticlesModule {}
