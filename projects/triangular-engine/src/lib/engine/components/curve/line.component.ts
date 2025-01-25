import { Component, effect, model, signal } from '@angular/core';
import { BufferGeometry, Line, Material } from 'three';
import { Object3DComponent, provideObject3DComponent } from '../object-3d';

@Component({
  selector: 'line',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(LineComponent)],
})
export class LineComponent extends Object3DComponent {
  readonly line = signal(new Line());
  override object3D = this.line;

  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = model<Material | undefined>(undefined);

  constructor() {
    super();

    this.#initSetMaterial();
    this.#initSetGeometry();
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
}
