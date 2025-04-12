import { NgModule, Type } from '@angular/core';
import { MeshComponent } from './mesh.component';
import { InstancedMeshComponent } from './instanced-mesh.component';

import { SkinnedMeshComponent } from './skinned-mesh.component';

const importExport: Array<Type<any>> = [
  MeshComponent,

  SkinnedMeshComponent,
  InstancedMeshComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineMeshComponentsModule {}
