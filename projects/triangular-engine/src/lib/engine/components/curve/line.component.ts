import { Component, effect, input, model, signal } from '@angular/core';
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  Material,
  Vector3,
  Vector3Tuple,
} from 'three';
import { Object3DComponent, provideObject3DComponent } from '../object-3d';

@Component({
  selector: 'line',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(LineComponent)],
})
export class LineComponent extends Object3DComponent {
  readonly line = signal(new Line());
  override object3D = this.line;

  readonly points = input<Vector3Tuple[]>();
  /** Defaults to `true` if not provided */
  readonly frustumCulled = input<boolean>();

  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = model<Material | undefined>(undefined);

  constructor() {
    super();

    this.#initSetMaterial();
    this.#initSetGeometry();
    this.#initSetPoints();
    this.#initSetFrustumCulled();
  }

  #initSetPoints() {
    effect(() => {
      const points = this.points();
      const geometry = this.geometry();

      if (geometry && points) {
        const vectors = points.map((point) => new Vector3(...point));
        const positionAttr = geometry.getAttribute('position') as BufferAttribute | undefined;

        if (!positionAttr || positionAttr.count < vectors.length) {
          // Capacity headroom: minimum 64 points, up to 50% extra, capped at max +10,000 points (120 KB RAM max step)
          const headroom = Math.min(Math.max(64, Math.ceil(vectors.length * 0.5)), 10000);
          const capacity = vectors.length + headroom;
          const newAttr = new Float32BufferAttribute(capacity * 3, 3);
          for (let i = 0; i < vectors.length; i++) {
            newAttr.setXYZ(i, vectors[i].x, vectors[i].y, vectors[i].z);
          }
          geometry.setAttribute('position', newAttr);
        } else {
          for (let i = 0; i < vectors.length; i++) {
            positionAttr.setXYZ(i, vectors[i].x, vectors[i].y, vectors[i].z);
          }
          positionAttr.needsUpdate = true;
        }

        geometry.setDrawRange(0, vectors.length);
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        this.line().computeLineDistances();
      }
    });
  }

  #initSetMaterial() {
    effect(() => {
      const material = this.material();
      const mesh = this.line();
      if (material) {
        mesh.material = material;
      }
    });
  }

  #initSetGeometry() {
    effect(() => {
      const geometry = this.geometry();
      const mesh = this.line();
      if (geometry) {
        mesh.geometry = geometry;
      }
    });
  }

  #initSetFrustumCulled() {
    effect(() => {
      const frustumCulled = this.frustumCulled();
      const mesh = this.line();

      mesh.frustumCulled =
        typeof frustumCulled === 'boolean' ? frustumCulled : true;
    });
  }
}
