import { NgModule } from '@angular/core';
import { LineBasicMaterialComponent } from './line-basic-material.component';
import {
  MeshNormalMaterialComponent,
  MeshStandardMaterialComponent,
  RawShaderMaterialComponent,
  ShaderMaterialComponent,
} from './material.component';
import { MeshBasicMaterialComponent } from './mesh-basic-material.component';
import { PointsMaterialComponent } from './points-material.component';
import { SpriteMaterialComponent } from './sprite-material.component';

const importExport = [
  //MaterialComponent,
  MeshNormalMaterialComponent,
  MeshBasicMaterialComponent,
  MeshStandardMaterialComponent,
  ShaderMaterialComponent,
  RawShaderMaterialComponent,
  SpriteMaterialComponent,
  PointsMaterialComponent,
  LineBasicMaterialComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineMaterialsModule {}
