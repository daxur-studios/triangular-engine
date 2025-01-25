import { Component, effect, input } from '@angular/core';
import RAPIER from '@dimforge/rapier3d-compat';

import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import { Vector3Tuple } from 'three';

@Component({
  selector: 'cuboidCollider',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideColliderComponent(CuboidColliderComponent)],
})
export class CuboidColliderComponent extends ColliderComponent {
  readonly halfExtents = input.required<Vector3Tuple>();

  constructor() {
    super();

    this.#initColliderDesc();
  }

  #initColliderDesc() {
    effect(
      () => {
        const halfExtents = this.halfExtents();

        this.colliderDesc.set(RAPIER.ColliderDesc.cuboid(...halfExtents));
      },
      { allowSignalWrites: true }
    );
  }
}
