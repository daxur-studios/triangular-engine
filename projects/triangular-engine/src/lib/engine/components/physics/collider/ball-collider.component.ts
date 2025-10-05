import { Component, effect, input } from '@angular/core';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import RAPIER, { ColliderDesc } from '@dimforge/rapier3d-compat';

@Component({
    selector: 'ballCollider',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideColliderComponent(BallColliderComponent)]
})
export class BallColliderComponent extends ColliderComponent {
  readonly radius = input.required<number>();

  constructor() {
    super();

    this.#initColliderDesc();
  }

  #initColliderDesc() {
    effect(
      () => {
        const radius = this.radius();

        this.colliderDesc.set(RAPIER.ColliderDesc.ball(radius));
      },
      { allowSignalWrites: true },
    );
  }
}
