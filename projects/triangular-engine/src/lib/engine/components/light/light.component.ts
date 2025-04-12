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

  readonly color = input<string>('#ffffff');
  readonly intensity = input<number>(1);

  abstract override readonly object3D: WritableSignal<Light>;

  get light() {
    return this.object3D;
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
