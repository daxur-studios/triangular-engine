import { Component, computed, effect, input, signal } from '@angular/core';
import { DirectionalLight } from 'three';
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
 * | castShadow | Whether the light casts shadows.                 | DirectionalLightComponent |
 */
@Component({
  selector: 'directionalLight',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideObject3DComponent(DirectionalLightComponent)],
})
export class DirectionalLightComponent extends LightComponent {
  public override emoji = '💡';

  override readonly object3D = signal(new DirectionalLight());

  public readonly normalizedPosition = computed(() => {
    const position = this.light().position;
    this.position();

    return position.clone().normalize();
  });

  constructor() {
    super();

    effect(() => {
      this.light().castShadow = true;
    });

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });
  }
}
