import { Component, effect, input } from '@angular/core';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import RAPIER, { ColliderDesc } from '@dimforge/rapier3d-compat';

@Component({
    selector: 'coneCollider',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideColliderComponent(ConeColliderComponent)]
})
export class ConeColliderComponent extends ColliderComponent {
  readonly halfHeight = input.required<number>();
  readonly radius = input.required<number>();

  constructor() {
    super();

    this.#initColliderDesc();
  }

  #initColliderDesc() {
    effect(
      () => {
        const radius = this.radius();
        const halfHeight = this.halfHeight();

        this.colliderDesc.set(RAPIER.ColliderDesc.cone(halfHeight, radius));
      },
      { allowSignalWrites: true },
    );
  }
}
