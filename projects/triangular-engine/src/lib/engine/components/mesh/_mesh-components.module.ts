import { NgModule, Type } from '@angular/core';
import { MeshComponent } from './mesh.component';
import { InstancedMeshComponent } from './instanced-mesh.component';
import { SphereComponent } from './sphere.component';

const importExport: Array<Type<any>> = [
  MeshComponent,
  SphereComponent,

  InstancedMeshComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineMeshComponentsModule {}
