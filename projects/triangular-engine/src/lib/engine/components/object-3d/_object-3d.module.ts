import { NgModule, Type } from '@angular/core';

import { ArrowHelperComponent } from './arrow-helper.component';
import { GridHelperComponent } from './grid-helper.component';
import { GroupComponent } from './group.component';

import { OrbitControlsComponent } from './orbit-controls.component';
import { PrimitiveComponent } from './primitive.component';
import { RaycastDirective } from './raycast';
import { SpriteComponent } from './sprite.component';
import { SceneComponent } from './scene/scene.component';
import { GltfComponent } from '../gltf';
import { CameraComponent } from './camera.component';

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
  GltfComponent,
  ArrowHelperComponent,
  SpriteComponent,
  RaycastDirective,
  CameraComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineObject3DModule {}
