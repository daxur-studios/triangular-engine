import { Component, effect, input } from '@angular/core';
import { BufferGeometry } from 'three';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';
import { Jolt } from '../jolt-physics/jolt-physics.service';

interface ITriMeshParams {
  geometry: BufferGeometry;
}

/** Must be used with a static motion type rigid body */
@Component({
  selector: 'jolt-mesh-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltMeshShapeComponent)],
})
export class JoltMeshShapeComponent extends JoltShapeComponent<Jolt.MeshShape> {
  readonly geometry = input.required<BufferGeometry>();

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
        const geometry = this.geometry();

        if (!geometry) return;

        this.updateShape({ geometry });
      },
      {
        injector: this.injector,
      },
    );
  }

  override createShape(params: ITriMeshParams): Jolt.MeshShape {
    return this.updateShape(params);
  }

  override updateShape(params: ITriMeshParams): Jolt.MeshShape {
    // Always recreate for simplicity
    this.disposeShape();

    const { triangles, materials } = this.#createTriangleList(params);

    const shape = new Jolt.MeshShapeSettings(triangles, materials)
      .Create()
      .Get() as Jolt.MeshShape;

    // Clean up temporary containers created on the C++ side
    Jolt.destroy(triangles);
    Jolt.destroy(materials);

    this.shape$.next(shape);
    shape.AddRef();
    return shape;
  }

  override disposeShape(): void {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }

  #createTriangleList(params: ITriMeshParams) {
    const triangles = new Jolt.TriangleList();
    // Default single material list (can be expanded in future)
    const materials = new Jolt.PhysicsMaterialList();

    let pos: Float32Array | undefined;
    let idx: Uint16Array | Uint32Array | undefined;

    if (params.geometry) {
      const geom = params.geometry;
      const posAttr = geom.attributes['position'];
      if (!posAttr) {
        throw new Error(
          'JoltTriMeshShape: geometry is missing position attribute',
        );
      }
      pos = posAttr.array as Float32Array;
      const indexAttr = geom.getIndex();
      idx = indexAttr
        ? (indexAttr.array as Uint16Array | Uint32Array)
        : undefined;
    }

    if (!pos || pos.length < 9) {
      throw new Error(
        'JoltTriMeshShape: not enough vertex data to form triangles',
      );
    }

    if (idx && idx.length % 3 !== 0) {
      throw new Error(
        'JoltTriMeshShape: indices length must be divisible by 3',
      );
    }

    const triangleCount = idx ? idx.length / 3 : Math.floor(pos.length / 9);
    triangles.resize(triangleCount);

    if (idx) {
      for (let t = 0; t < triangleCount; t++) {
        const i0 = idx[t * 3 + 0];
        const i1 = idx[t * 3 + 1];
        const i2 = idx[t * 3 + 2];
        const base0 = i0 * 3;
        const base1 = i1 * 3;
        const base2 = i2 * 3;
        const tri = triangles.at(t);
        const v0 = tri.get_mV(0);
        const v1 = tri.get_mV(1);
        const v2 = tri.get_mV(2);
        v0.x = pos[base0 + 0];
        v0.y = pos[base0 + 1];
        v0.z = pos[base0 + 2];
        v1.x = pos[base1 + 0];
        v1.y = pos[base1 + 1];
        v1.z = pos[base1 + 2];
        v2.x = pos[base2 + 0];
        v2.y = pos[base2 + 1];
        v2.z = pos[base2 + 2];
      }
    } else {
      for (let t = 0; t < triangleCount; t++) {
        const base = t * 9;
        const tri = triangles.at(t);
        const v0 = tri.get_mV(0);
        const v1 = tri.get_mV(1);
        const v2 = tri.get_mV(2);
        v0.x = pos[base + 0];
        v0.y = pos[base + 1];
        v0.z = pos[base + 2];
        v1.x = pos[base + 3];
        v1.y = pos[base + 4];
        v1.z = pos[base + 5];
        v2.x = pos[base + 6];
        v2.y = pos[base + 7];
        v2.z = pos[base + 8];
      }
    }

    return { triangles, materials } as const;
  }
}
