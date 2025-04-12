import { NgModule, Type } from '@angular/core';
import { BoxGeometryComponent } from './geometry.component';
import { SphereGeometryComponent } from './geometry.component';
import { PlaneGeometryComponent } from './geometry.component';
import { CapsuleGeometryComponent } from './capsule-geometry.component';
import { BufferGeometryComponent } from './geometry.component';
import { BufferAttributeComponent } from './buffer-attribute.component';

const importExport: Array<Type<any>> = [
  BoxGeometryComponent,
  SphereGeometryComponent,
  PlaneGeometryComponent,
  CapsuleGeometryComponent,
  BufferGeometryComponent,
  BufferAttributeComponent,
];

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineGeometryModule {}
