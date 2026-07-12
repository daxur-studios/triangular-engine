import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import {
  EffectComposerComponent,
  EngineCssComponentsModule,
  EngineCurveModule,
  EngineGeometryModule,
  EngineLightModule,
  EngineMaterialsModule,
  EngineMeshComponentsModule,
  EngineObject3DModule,
  EngineParticlesModule,
  GlitchPassComponent,
  KeyboardControlsComponent,
  OutputPassComponent,
  RenderTargetComponent,
  SMAAPassComponent,
  UnrealBloomPassComponent,
} from './components';
import { EnginePortalDirective } from './components/engine-ui/engine-portal.directive';
import { EnginePortalOutletComponent } from './components/engine-ui/engine-portal-outlet.component';
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

  EnginePortalDirective,
  EnginePortalOutletComponent,
  KeyboardControlsComponent,

  RenderTargetComponent,

  EffectComposerComponent,
  UnrealBloomPassComponent,
  GlitchPassComponent,
  OutputPassComponent,
  SMAAPassComponent,
] as const;

/**
 * 🐉 Import this to a standalone component to have access to all the engine components.
 */
@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineModule {}
