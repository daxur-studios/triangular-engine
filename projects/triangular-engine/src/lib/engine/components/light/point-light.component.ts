import { Component, effect, input, signal } from '@angular/core';
import { LightShadow, OrthographicCamera, PointLight } from 'three';
import { provideObject3DComponent } from '../object-3d/object-3d.component';
import { LightComponent } from './light.component';

/**
 * Component Inputs:
 * | Property   | Description                                      | Source            |
 * |------------|--------------------------------------------------|-------------------|
 * | color      | The color of the light.                          | LightComponent    |
 * | intensity  | The intensity of the light.                      | LightComponent    |
 * | distance   | The distance of the light.                       | PointLightComponent |
 * | decay      | The decay rate of the light.                     | PointLightComponent |
 */
@Component({
  selector: 'pointLight',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(PointLightComponent)],
})
export class PointLightComponent extends LightComponent {
  public override emoji = '💡';

  readonly distance = input<number>(0);
  readonly decay = input<number>(1);

  readonly castShadow = input<boolean>();

  override readonly object3D = signal(new PointLight());

  constructor() {
    super();

    effect(() => {
      this.light().color.set(this.color());
    });

    effect(() => {
      this.light().intensity = this.intensity();
    });

    effect(() => {
      (this.light() as PointLight).distance = this.distance();
    });

    effect(() => {
      (this.light() as PointLight).decay = this.decay();
    });

    effect(() => {
      const castShadow = this.castShadow();
      const pointLight = this.light();

      pointLight.castShadow = castShadow ?? false;

      // if (castShadow && pointLight.shadow) {
      //   // resolution vs perf
      //   pointLight.shadow?.mapSize.set(2048, 2048); // 4096 if you really need sharper

      //   // a big orthographic frustum that covers your ground
      //   const cam = pointLight.shadow?.camera as OrthographicCamera;
      //   const d = 1000; // half-extent in world units (covers 2km square)
      //   cam.left = -d;
      //   cam.right = d;
      //   cam.top = d;
      //   cam.bottom = -d;
      //   cam.near = 0.5;
      //   cam.far = 5000; // long enough for low sun angles
      //   cam.updateProjectionMatrix();
      //   pointLight.shadow.bias = -0.0005;
      //   pointLight.shadow.normalBias = 0.5; // 0.2–1.0 typical
      // }
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.light().dispose();
  }
}
