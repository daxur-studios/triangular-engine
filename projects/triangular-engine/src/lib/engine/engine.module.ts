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
  RenderTargetComponent,
} from './components';
import { EngineSlotDirective } from './components/engine-ui/engine-slot.directive';
import { EngineDirectiveModule } from './directive';
import { EngineEnvironmentModule, EngineFeaturesModule } from './features';

const importExport = [
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
  EngineDirectiveModule,

  EngineSlotDirective,
  KeyboardControlsComponent,

  RenderTargetComponent,
] as const;

/**
 * 🐉 Import this to a standalone component to have access to all the engine components.
 */
@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineModule {}
