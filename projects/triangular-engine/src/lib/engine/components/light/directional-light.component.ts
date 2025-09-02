import { Component, computed, effect, input, signal } from '@angular/core';
import { DirectionalLight, OrthographicCamera } from 'three';
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
  override get light() {
    return this.object3D;
  }

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
      const castShadow = this.castShadow();

      const directionalLight = this.light();
      directionalLight.castShadow = castShadow;

      if (castShadow) {
        // resolution vs perf
        directionalLight.shadow.mapSize.set(2048, 2048); // 4096 if you really need sharper

        // a big orthographic frustum that covers your ground
        const cam = directionalLight.shadow.camera as OrthographicCamera;
        const d = 1000; // half-extent in world units (covers 2km square)
        cam.left = -d;
        cam.right = d;
        cam.top = d;
        cam.bottom = -d;
        cam.near = 0.5;
        cam.far = 5000; // long enough for low sun angles
        cam.updateProjectionMatrix();
        directionalLight.shadow.bias = -0.0005;
        directionalLight.shadow.normalBias = 0.5; // 0.2–1.0 typical
      }
    });

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });
  }
}
