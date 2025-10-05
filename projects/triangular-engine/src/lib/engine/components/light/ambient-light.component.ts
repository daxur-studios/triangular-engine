import { Component, effect, input, signal } from '@angular/core';
import { AmbientLight } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { LightComponent } from './light.component';

/**
 * Component Inputs:
 * | Property   | Description                                      | Source            |
 * |------------|--------------------------------------------------|-------------------|
 * | color      | The color of the light.                          | LightComponent    |
 * | intensity  | The intensity of the light.                      | LightComponent    |
 */
@Component({
    selector: 'ambientLight',
    template: `<ng-content></ng-content>`,
    imports: [],
    providers: [provideObject3DComponent(AmbientLightComponent)]
})
export class AmbientLightComponent extends LightComponent {
  public override emoji = '💡';

  override readonly object3D = signal(new AmbientLight());

  constructor() {
    super();

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });
  }
}
