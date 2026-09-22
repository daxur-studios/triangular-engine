import { Component, effect, input } from '@angular/core';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';
import { Jolt } from '../jolt-physics/jolt-physics.service';

/** [halfHeight, radius]; the cylinder's axis is local Y. */
type CylinderShapeParams = [number, number];

/** Jolt's `cDefaultConvexRadius`; clamped below so thin cylinders stay valid. */
const DEFAULT_CONVEX_RADIUS = 0.05;

@Component({
  selector: 'joltCylinderShape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltCylinderShapeComponent)],
})
export class JoltCylinderShapeComponent extends JoltShapeComponent<Jolt.CylinderShape> {
  /** [halfHeight, radius]; the cylinder's axis is local Y. */
  readonly params = input<CylinderShapeParams>([0.5, 0.5]);

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

  createShape([halfHeight, radius]: CylinderShapeParams) {
    // Jolt rejects a convex radius larger than either dimension.
    const convexRadius = Math.min(DEFAULT_CONVEX_RADIUS, halfHeight, radius);
    const shape = new Jolt.CylinderShape(halfHeight, radius, convexRadius);

    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  updateShape(params: CylinderShapeParams) {
    // Cannot update CylinderShape, so we need to create a new one and dispose the old one
    this.disposeShape();

    return this.createShape(params);
  }

  disposeShape() {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }
}
