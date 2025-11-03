import { NgModule } from '@angular/core';

import { ArrowHelperComponent } from './arrow-helper.component';
import { AxesHelperComponent } from './axes-helper.component';
import { GridHelperComponent } from './grid-helper.component';
import { GroupComponent } from './group.component';

import { GltfComponent } from '../gltf';
import { CameraComponent } from './camera.component';
import { OrbitControlsComponent } from './orbit-controls.component';
import { PrimitiveComponent } from './primitive.component';
import { RaycastDirective } from './raycast';
import { SceneComponent } from './scene/scene.component';
import { SpriteComponent } from './sprite.component';
import { OrthographicCameraComponent } from './orthographic-camera.component';

const importExport = [
  ArrowHelperComponent,
  AxesHelperComponent,
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
  OrthographicCameraComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineObject3DModule {}
