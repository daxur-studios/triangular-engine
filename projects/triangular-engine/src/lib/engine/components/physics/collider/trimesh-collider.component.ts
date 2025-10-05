import { Component, effect, input } from '@angular/core';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import RAPIER, { ColliderDesc } from '@dimforge/rapier3d-compat';
import { BufferGeometry } from 'three';

/**
 * Provide vertices and indices OR geometry as input to generate the trimesh collider
 */
@Component({
  selector: 'trimeshCollider',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideColliderComponent(TrimeshColliderComponent)],
})
export class TrimeshColliderComponent extends ColliderComponent {
  readonly vertices = input<Float32Array>();
  readonly indices = input<Uint32Array>();
  readonly geometry = input<BufferGeometry>();

  constructor() {
    super();

    this.#initColliderDesc();
  }

  #initColliderDesc() {
    effect(() => {
      const vertices = this.vertices();
      const indices = this.indices();
      const geometry = this.geometry();

      if (!vertices && !geometry) {
        return;
      }

      let vertexData: Float32Array;
      let indexData: Uint32Array;

      if (geometry) {
        vertexData = geometry.attributes['position'].array as Float32Array;
        indexData = geometry.index?.array as Uint32Array;

        if (!indexData) {
          console.error('Geometry must have an index for trimesh collider');
          return;
        }
      } else {
        if (!vertices || !indices) {
          console.error(
            'Both vertices and indices are required for trimesh collider',
          );
          return;
        }
        vertexData = vertices;
        indexData = indices;
      }

      const x = RAPIER.ColliderDesc.trimesh(vertexData, indexData);

      if (!x) {
        console.error('Failed to create trimesh collider desc');
        return;
      }

      this.colliderDesc.set(x);
    });
  }
}
