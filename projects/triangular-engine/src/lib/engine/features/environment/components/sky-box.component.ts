import { Component, effect, inject, input, signal } from '@angular/core';
import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Vector3 } from 'three';
import {
  MeshComponent,
  Object3DComponent,
  provideObject3DComponent,
} from '../../../components';
import { SkyBoxMaterialComponent } from '../materials';

@Component({
  selector: 'skyBox',
  standalone: true,
  template: `
    <skyBoxMaterial />
    <ng-content></ng-content>
  `,
  imports: [SkyBoxMaterialComponent],
  providers: [provideObject3DComponent(SkyBoxComponent)],
})
export class SkyBoxComponent extends MeshComponent {}
