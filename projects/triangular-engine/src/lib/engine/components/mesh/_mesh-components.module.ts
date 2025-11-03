import { NgModule } from '@angular/core';
import { InstancedMeshComponent } from './instanced-mesh.component';
import { MeshComponent } from './mesh.component';

import { SkinnedMeshComponent } from './skinned-mesh.component';

const importExport = [
  MeshComponent,

  SkinnedMeshComponent,
  InstancedMeshComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineMeshComponentsModule {}
