import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import {
  EngineCssComponentsModule,
  EngineCurveModule,
  EngineGeometryModule,
  EngineLightModule,
  EngineMaterialsModule,
  EngineMeshComponentsModule,
  EngineObject3DModule,
  EngineParticlesModule,
  KeyboardControlsComponent,
  PhysicsComponentsModule,
} from './components';
import { EngineSlotDirective } from './components/engine-ui/engine-slot.directive';
import { EngineEnvironmentModule, EngineFeaturesModule } from './features';

const importExport = [
  PhysicsComponentsModule,
  EngineMaterialsModule,
  EngineParticlesModule,
  EngineMeshComponentsModule,
  EngineCurveModule,
  EngineEnvironmentModule,
  EngineCssComponentsModule,
  EngineLightModule,
  EngineGeometryModule,
  EngineObject3DModule,
  EngineFeaturesModule,

  EngineSlotDirective,
  KeyboardControlsComponent,
] as const;

/**
 * 🐉 Import this to a standalone component to have access to all the engine components.
 */
@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineModule {}
