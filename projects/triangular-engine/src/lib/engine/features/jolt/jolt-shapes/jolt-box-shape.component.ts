import { Component, effect, input } from '@angular/core';
import Jolt from 'jolt-physics/wasm-compat';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';

type BoxShapeParams = [number, number, number];

@Component({
  selector: 'jolt-box-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltBoxShapeComponent)],
})
export class JoltBoxShapeComponent extends JoltShapeComponent<Jolt.BoxShape> {
  /** [width, height, depth] */
  readonly params = input<BoxShapeParams>([1, 1, 1]);

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

  createShape(params: BoxShapeParams) {
    const halfExtents = new Jolt.Vec3(
      params[0] / 2,
      params[1] / 2,
      params[2] / 2,
    );
    const shape = new Jolt.BoxShape(halfExtents, 0.05, undefined);
    Jolt.destroy(halfExtents);

    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  updateShape(params: BoxShapeParams) {
    // Cannot update BoxShape, so we need to create a new one and dispose the old one
    this.disposeShape();

    return this.createShape(params);
  }

  disposeShape() {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }
}
