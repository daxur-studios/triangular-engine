import { Component, effect, input } from '@angular/core';
import {
  ColliderComponent,
  provideColliderComponent,
} from './_collider.component';
import RAPIER, { ColliderDesc } from '@dimforge/rapier3d-compat';

@Component({
    selector: 'cylinderCollider',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideColliderComponent(CylinderColliderComponent)]
})
export class CylinderColliderComponent extends ColliderComponent {
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

        this.colliderDesc.set(RAPIER.ColliderDesc.cylinder(halfHeight, radius));
      },
      { allowSignalWrites: true },
    );
  }
}
