import { Component, effect, input } from '@angular/core';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import RAPIER, { ColliderDesc } from '@dimforge/rapier3d-compat';
import { BufferGeometry } from 'three';

/**
 * Provide positions OR geometry as input to generate the hull collider
 */
@Component({
  selector: 'hullCollider',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideColliderComponent(HullColliderComponent)],
})
export class HullColliderComponent extends ColliderComponent {
  readonly positions = input<Float32Array>();
  readonly geometry = input<BufferGeometry>();

  constructor() {
    super();

    this.#initColliderDesc();
  }

  #initColliderDesc() {
    effect(() => {
      const positions = this.positions();
      const geometry = this.geometry();

      if (!positions && !geometry) {
        return;
      }

      const data =
        (geometry?.attributes['position'].array as Float32Array) || positions;

      const x = RAPIER.ColliderDesc.convexHull(data);

      if (!x) {
        console.error('Failed to create hull collider desc');
        return;
      }

      this.colliderDesc.set(x);
    });
  }
}
