import { NgModule } from '@angular/core';
import { BufferAttributeComponent } from './buffer-attribute.component';
import { CapsuleGeometryComponent } from './capsule-geometry.component';
import {
  BoxGeometryComponent,
  BufferGeometryComponent,
  CylinderGeometryComponent,
  PlaneGeometryComponent,
  SphereGeometryComponent,
  TorusKnotGeometryComponent,
} from './geometry.component';
import { HeightMapGeometryComponent } from './height-map-geometry.component';

const importExport = [
  BoxGeometryComponent,
  SphereGeometryComponent,
  PlaneGeometryComponent,
  TorusKnotGeometryComponent,
  CylinderGeometryComponent,
  CapsuleGeometryComponent,
  BufferGeometryComponent,
  BufferAttributeComponent,
  HeightMapGeometryComponent,
] as const;

@NgModule({
  imports: [...importExport],
  exports: [...importExport],
})
export class EngineGeometryModule {}
