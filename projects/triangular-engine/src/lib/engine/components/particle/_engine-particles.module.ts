import { NgModule } from '@angular/core';
import { ParticleEmitterComponent } from './particle-emitter.component';
import { ParticleSystemComponent } from './particle-system.component';
import { PointsComponent } from './points.component';

const importExport = [
  ParticleEmitterComponent,
  PointsComponent,
  ParticleSystemComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineParticlesModule {}
