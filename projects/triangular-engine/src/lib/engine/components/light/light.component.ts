import {
  Component,
  Injector,
  Optional,
  SkipSelf,
  computed,
  effect,
  input,
  signal,
  Directive,
  Signal,
  WritableSignal,
} from '@angular/core';
import {
  AmbientLight,
  DirectionalLight,
  PointLight,
  Vector3Like,
  Light,
  Object3D,
  ColorRepresentation,
  OrthographicCamera,
} from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { BehaviorSubject } from 'rxjs';

/** Abstract base class for lights components */
@Component({
  standalone: true,
  selector: 'light',
  template: `<ng-content></ng-content>`,
})
export abstract class LightComponent extends Object3DComponent {
  public override emoji = '💡';

  readonly color = input<string | ColorRepresentation>('#ffffff');
  readonly intensity = input<number>(1);
  readonly shadow = input<LightShadowParams>();

  abstract override readonly object3D: WritableSignal<Light>;

  get light() {
    return this.object3D;
  }

  constructor() {
    super();
    this.#initShadow();
  }

  #initShadow() {
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
}

// @Component({
//   selector: 'ambientLight',
//   template: `<ng-content></ng-content>`,

//   standalone: true,
//   imports: [],
//   providers: [provideObject3DComponent(AmbientLightComponent)],
// })
// export class AmbientLightComponent extends LightComponent {
//   override readonly object3D = signal(new AmbientLight());

//   constructor() {
//     super();

//     effect(() => {
//       this.light().color.set(this.color());
//     });

//     effect(() => {
//       this.light().intensity = this.intensity();
//     });
//   }
// }

// @Component({
//   selector: 'directionalLight',
//   template: `<ng-content></ng-content>`,

//   standalone: true,
//   imports: [],
//   providers: [provideObject3DComponent(DirectionalLightComponent)],
// })
// export class DirectionalLightComponent extends LightComponent {
//   public readonly normalizedPosition = computed(() => {
//     const position = this.light().position;
//     this.position();

//     return position.clone().normalize();
//   });

//   constructor() {
//     super();

//     effect(() => {
//       this.light().castShadow = true;
//     });

//     effect(() => {
//       this.light().color.set(this.color());
//     });

//     effect(() => {
//       this.light().intensity = this.intensity();
//     });
//   }
// }

// @Component({
//   selector: 'pointLight',
//   template: `<ng-content></ng-content>`,

//   standalone: true,
//   imports: [],
//   providers: [provideObject3DComponent(PointLightComponent)],
// })
// export class PointLightComponent extends LightComponent {
//   readonly distance = input<number>(0);
//   readonly decay = input<number>(1);

//   constructor() {
//     super();

//     effect(() => {
//       this.light().color.set(this.color());
//     });

//     effect(() => {
//       this.light().intensity = this.intensity();
//     });

//     effect(() => {
//       this.light().distance = this.distance();
//     });

//     effect(() => {
//       this.light().decay = this.decay();
//     });
//   }

//   override ngOnDestroy(): void {
//     super.ngOnDestroy();
//     this.light().dispose();
//   }
// }

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
