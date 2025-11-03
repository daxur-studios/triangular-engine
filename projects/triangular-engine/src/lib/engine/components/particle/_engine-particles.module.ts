import { NgModule } from '@angular/core';
import { ParticleSystemComponent } from './particle-system.component';
import { PointsComponent } from './points.component';

const importExport = [PointsComponent, ParticleSystemComponent] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineParticlesModule {}
