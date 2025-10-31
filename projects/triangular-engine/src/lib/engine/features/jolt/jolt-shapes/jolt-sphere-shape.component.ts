import { Component, effect, input } from '@angular/core';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';
import { Jolt } from '../jolt-physics/jolt-physics.service';

interface ISphereShapeParams {
  radius: number;
}

@Component({
  selector: 'jolt-sphere-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltSphereShapeComponent)],
})
export class JoltSphereShapeComponent extends JoltShapeComponent<Jolt.SphereShape> {
  readonly radius = input<number>(1);

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
        const radius = this.radius();

        this.updateShape({ radius });
      },
      {
        injector: this.injector,
      },
    );
  }

  createShape(params: ISphereShapeParams) {
    const shape = new Jolt.SphereShape(params.radius);
    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  updateShape(params: ISphereShapeParams) {
    // Cannot update SphereShape, so we need to create a new one and dispose the old one
    this.disposeShape();

    return this.createShape(params);
  }

  disposeShape() {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }
}
