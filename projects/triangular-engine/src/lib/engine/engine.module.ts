import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import {
  AmbientLightComponent,
  ArrowHelperComponent,
  BoxGeometryComponent,
  BufferAttributeComponent,
  CapsuleGeometryComponent,
  DirectionalLightComponent,
  EngineMeshComponentsModule,
  GltfComponent,
  GridHelperComponent,
  GroupComponent,
  KeyboardControlsComponent,
  MeshBasicMaterialComponent,
  MeshNormalMaterialComponent,
  MeshStandardMaterialComponent,
  OrbitControlsComponent,
  PhysicsComponentsModule,
  PointLightComponent,
  EngineParticlesModule,
  PointsMaterialComponent,
  RaycastDirective,
  SceneComponent,
  SphereGeometryComponent,
  EngineMaterialsModule,
  SpriteComponent,
  PrimitiveComponent,
  EngineUiComponent,
} from './components';
import { EngineEnvironmentModule } from './features';
import { EngineCurveModule } from './components/curve';
import { EngineSlotDirective } from './components/engine-ui/engine-slot.directive';
import { EngineCssComponentsModule } from './components/css';
import { EngineObject3DModule } from './components/object-3d/_object-3d.module';

const importExport = [
  CommonModule,
  PhysicsComponentsModule,
  EngineMaterialsModule,
  EngineParticlesModule,
  EngineMeshComponentsModule,
  EngineCurveModule,
  EngineEnvironmentModule,
  EngineCssComponentsModule,
  EngineObject3DModule,

  EngineSlotDirective,
  KeyboardControlsComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineModule {}
