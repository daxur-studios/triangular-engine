import { Component, computed, effect, input, signal } from '@angular/core';
import { DirectionalLight } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { LightComponent } from './light.component';
import { toObservable } from '@angular/core/rxjs-interop';

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

  readonly castShadow = input<boolean>(true);
  readonly castShadow$ = toObservable(this.castShadow);

  public readonly normalizedPosition = computed(() => {
    const position = this.light().position;
    this.position();

    return position.clone().normalize();
  });

  constructor() {
    super();

    effect(() => {
      this.light().castShadow = this.castShadow();

      //    const directionalLight = this.light();
      // if (directionalLight.shadow) {
      //   directionalLight.shadow.mapSize.width = 1024;
      //   directionalLight.shadow.mapSize.height = 1024;
      //   directionalLight.shadow.camera.near = 1;
      //   directionalLight.shadow.camera.far = 50;
      //   directionalLight.shadow.camera.left = -10;
      //   directionalLight.shadow.camera.right = 10;
      //   directionalLight.shadow.camera.top = 10;
      //   directionalLight.shadow.camera.bottom = -10;
      // }
    });

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });
  }
}
