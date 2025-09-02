import { NgModule } from '@angular/core';
import { BufferAttributeComponent } from './buffer-attribute.component';
import { CapsuleGeometryComponent } from './capsule-geometry.component';
import {
  BoxGeometryComponent,
  BufferGeometryComponent,
  PlaneGeometryComponent,
  SphereGeometryComponent,
} from './geometry.component';

const importExport = [
  BoxGeometryComponent,
  SphereGeometryComponent,
  PlaneGeometryComponent,
  CapsuleGeometryComponent,
  BufferGeometryComponent,
  BufferAttributeComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineGeometryModule {}
