import {
  Component,
  computed,
  contentChild,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { BufferGeometry, Material, Points } from 'three';
import { Object3DComponent, provideObject3DComponent } from '../object-3d';
import { BufferGeometryComponent } from '../geometry';
import { MaterialComponent } from '../materials';

@Component({
    selector: 'points',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideObject3DComponent(PointsComponent)]
})
export class PointsComponent extends Object3DComponent {
  readonly points = signal(new Points());
  get object3D() {
    return this.points;
  }

  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = signal<Material | undefined>(undefined);

  constructor() {
    super();

    this.#initSetGeometry();
    this.#initSetMaterial();
  }

  #initSetGeometry() {
    effect(() => {
      const geometry = this.geometry();
      const points = this.points();
      if (geometry) {
        points.geometry = geometry;
      }
    });
  }

  #initSetMaterial() {
    effect(() => {
      const material = this.material();
      const points = this.points();
      if (material) {
        points.material = material;
      }
    });
  }
}
