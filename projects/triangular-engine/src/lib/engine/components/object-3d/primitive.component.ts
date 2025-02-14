import { Component, input, model, signal } from '@angular/core';
import { Object3D } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';

/**
 * PrimitiveComponent is an Angular component that extends the Object3DComponent.
 * It represents a Three.js Object3D primitive and allows it to be used within an Angular application.
 */
@Component({
  standalone: true,
  selector: 'primitive',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(PrimitiveComponent)],
})
export class PrimitiveComponent extends Object3DComponent {
  override emoji = '🔰';

  readonly object = model<Object3D>(new Object3D());
  override readonly object3D = this.object;

  constructor() {
    super();
    this.#initObject();
  }

  #initObject() {
    const object = this.object();
    if (object) {
      this.object3D.set(object);
    }
  }
}
