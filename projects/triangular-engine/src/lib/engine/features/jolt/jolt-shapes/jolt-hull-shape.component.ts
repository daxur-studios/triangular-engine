import { Component, effect, input } from '@angular/core';
import { provideShapeComponent } from './jolt-shape.component';
import { JoltShapeComponent } from './jolt-shape.component';
import { BufferGeometry } from 'three';
import Jolt from 'jolt-physics/wasm-compat';

/**
 * Provide either positions or geometry but not both at the same time to generate the hull shape.
 */
@Component({
  selector: 'jolt-hull-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltHullShapeComponent)],
})
export class JoltHullShapeComponent extends JoltShapeComponent<Jolt.ConvexHullShape> {
  /**
   * Provide either positions or geometry but not both at the same time to generate the hull shape.
   */
  readonly positions = input<Float32Array>();
  /**
   * Provide either positions or geometry but not both at the same time to generate the hull shape.
   */
  readonly geometry = input<BufferGeometry>();

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
        const positions = this.positions();
        const geometry = this.geometry();

        this.updateShape({ positions, geometry });
      },
      {
        injector: this.injector,
      },
    );
  }

  override updateShape(params: IHullShapeParams): Jolt.ConvexHullShape {
    // Cannot update SphereShape, so we need to create a new one and dispose the old one
    this.disposeShape();

    const { positions, geometry } = params;

    // Convert geometry or positions to Jolt.ArrayVec3
    const points: Jolt.Vec3[] = [];
    if (geometry) {
      for (let i = 0; i < geometry.attributes['position'].count; i++) {
        points.push(
          new Jolt.Vec3(
            geometry.attributes['position'].getX(i),
            geometry.attributes['position'].getY(i),
            geometry.attributes['position'].getZ(i),
          ),
        );
      }
    } else if (positions) {
      for (let i = 0; i < positions.length; i++) {
        points.push(
          new Jolt.Vec3(positions[i], positions[i + 1], positions[i + 2]),
        );
      }
    }

    const hull = new Jolt.ConvexHullShapeSettings();

    points.forEach((point) => {
      hull.mPoints.push_back(point);
    });

    const shape = hull.Create().Get() as Jolt.ConvexHullShape;

    Jolt.destroy(hull);
    points.forEach((point) => {
      Jolt.destroy(point);
    });

    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  createShape(params: { positions: Float32Array; geometry: BufferGeometry }) {
    return this.updateShape(params);
  }

  disposeShape() {
    const shape = this.shape$.value;
    shape?.Release();
    if (this.shape$.value) {
      this.shape$.next(undefined);
    }
  }
}

interface IHullShapeParams {
  positions?: Float32Array;
  geometry?: BufferGeometry;
}
