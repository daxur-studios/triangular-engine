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
  CommonModule,
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
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineModule {}
