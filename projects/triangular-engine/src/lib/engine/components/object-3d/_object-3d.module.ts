import { NgModule, Type } from '@angular/core';

import { ArrowHelperComponent } from './arrow-helper.component';
import { GridHelperComponent } from './grid-helper.component';
import { GroupComponent } from './group.component';

import { OrbitControlsComponent } from './orbit-controls.component';
import { PrimitiveComponent } from './primitive.component';
import { RaycastDirective } from './raycast';
import { SpriteComponent } from './sprite.component';
import { SceneComponent } from './scene/scene.component';
import { PointLightComponent } from '../light';
import { AmbientLightComponent } from '../light';
import { DirectionalLightComponent } from '../light';
import { SphereGeometryComponent } from '../geometry';
import { BoxGeometryComponent } from '../geometry';
import { CapsuleGeometryComponent } from '../geometry';
import { BufferAttributeComponent } from '../geometry';
import { GltfComponent } from '../gltf';

const importExport: Array<Type<any>> = [
  ArrowHelperComponent,
  GridHelperComponent,
  GroupComponent,
  OrbitControlsComponent,
  PrimitiveComponent,
  RaycastDirective,
  SpriteComponent,
  SceneComponent,
  PrimitiveComponent,
  GridHelperComponent,
  OrbitControlsComponent,
  GroupComponent,
  PointLightComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  SphereGeometryComponent,
  BoxGeometryComponent,
  CapsuleGeometryComponent,
  BufferAttributeComponent,
  GltfComponent,
  ArrowHelperComponent,
  SpriteComponent,
  RaycastDirective,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineObject3DModule {}
