import { NgModule, Type } from '@angular/core';
import { SpriteMaterialComponent } from './sprite-material.component';
import { PointsMaterialComponent } from './points-material.component';
import {
  MaterialComponent,
  MeshNormalMaterialComponent,
  MeshStandardMaterialComponent,
  RawShaderMaterialComponent,
  ShaderMaterialComponent,
} from './material.component';
import { MeshBasicMaterialComponent } from './mesh-basic-material.component';
import { LineBasicMaterialComponent } from './line-basic-material.component';

const importExport: Type<any>[] = [
  //MaterialComponent,
  MeshNormalMaterialComponent,
  MeshBasicMaterialComponent,
  MeshStandardMaterialComponent,
  ShaderMaterialComponent,
  RawShaderMaterialComponent,
  SpriteMaterialComponent,
  PointsMaterialComponent,
  LineBasicMaterialComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineMaterialsModule {}
