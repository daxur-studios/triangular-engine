import { Component, effect, input } from '@angular/core';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';

@Component({
    selector: 'capsuleCollider',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideColliderComponent(CapsuleColliderComponent)]
})
export class CapsuleColliderComponent extends ColliderComponent {
  readonly halfHeight = input.required<number>();
  readonly radius = input.required<number>();

  constructor() {
    super();

    this.#initCreateColliderDesc();
  }

  #initCreateColliderDesc() {
    effect(
      () => {
        const halfExtents = this.halfHeight();
        const radius = this.radius();

        this.colliderDesc.set(RAPIER.ColliderDesc.capsule(halfExtents, radius));
      },
      { allowSignalWrites: true }
    );
  }
}
