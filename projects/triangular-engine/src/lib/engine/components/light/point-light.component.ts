import { Component, effect, input, signal } from '@angular/core';
import { LightShadow, OrthographicCamera, PointLight } from 'three';
import { provideObject3DComponent } from '../object-3d/object-3d.component';
import { LightComponent } from './light.component';

export type LightShadowParams = {
  /** Width and height of the shadow map. Default is 1024 for better quality shadows. */
  mapSize?: [width: number, height: number]; // e.g., [1024,1024] (try 2048 if needed)
  /** Near clipping plane for shadow camera. Default is 1e-4 for tight frustum. */
  cameraNear?: number; // e.g., 1e-4
  /** Far clipping plane for shadow camera. Default is 2.0, just enough to cover receivers. */
  cameraFar?: number; // e.g., 2.0
  /** Shadow bias to reduce artifacts. Tweak between -1e-5 and -5e-4 as needed. */
  bias?: number; // e.g., -1e-4
  /** Normal bias helps with shadow acne on PBR materials. */
  normalBias?: number; // e.g., 0.02
};

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
  readonly shadow = input<LightShadowParams>();

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

    effect(() => {
      const shadowParams = this.shadow();
      if (!shadowParams) {
        return;
      }

      const pointLight = this.light();

      const setterFactory: {
        [key in keyof Required<LightShadowParams>]?: (
          value: LightShadowParams[key],
        ) => void;
      } = {
        mapSize: (value) => {
          pointLight.shadow?.mapSize.set(value?.[0] || 512, value?.[1] || 512);
        },
        cameraNear: (value) => {
          if (!pointLight.shadow) return;
          (pointLight.shadow.camera as OrthographicCamera).near = value ?? 0.1;
        },
        cameraFar: (value) => {
          if (!pointLight.shadow) return;
          (pointLight.shadow.camera as OrthographicCamera).far = value ?? 1000;
        },
        bias: (value) => {
          if (!pointLight.shadow) return;
          pointLight.shadow.bias = value ?? 0;
        },
        normalBias: (value) => {
          if (!pointLight.shadow) return;
          pointLight.shadow.normalBias = value ?? 0;
        },
      };

      const keys: (keyof Required<LightShadowParams>)[] = Object.keys(
        shadowParams,
      ) as any;

      keys.forEach((key) => {
        if (!pointLight.shadow) {
          return;
        }

        setterFactory[key]?.(shadowParams[key] as any);
      });
    });
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.light().dispose();
  }
}
