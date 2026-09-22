import { Component, effect, input } from '@angular/core';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';
import { Jolt } from '../jolt-physics/jolt-physics.service';

/** [halfHeight of the cylinder part, radius]; the capsule's axis is local Y. */
type CapsuleShapeParams = [number, number];

@Component({
  selector: 'joltCapsuleShape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltCapsuleShapeComponent)],
})
export class JoltCapsuleShapeComponent extends JoltShapeComponent<Jolt.CapsuleShape> {
  /** [halfHeight of the cylinder part, radius]; the capsule's axis is local Y. */
  readonly params = input<CapsuleShapeParams>([0.5, 0.5]);

  constructor() {
    super();

    this.#initAsync();
  }

  async #initAsync() {
    await this.physicsService.metaDataPromise;

    this.#initInputs();
  }

  #initInputs() {
    effect(
      () => {
        const params = this.params();
        this.updateShape(params);
      },
      {
        injector: this.injector,
      },
    );
  }

  createShape([halfHeight, radius]: CapsuleShapeParams) {
    const shape = new Jolt.CapsuleShape(halfHeight, radius);

    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  updateShape(params: CapsuleShapeParams) {
    // Cannot update CapsuleShape, so we need to create a new one and dispose the old one
    this.disposeShape();

    return this.createShape(params);
  }

  disposeShape() {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }
}
