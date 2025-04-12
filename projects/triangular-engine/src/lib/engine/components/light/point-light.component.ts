import { Component, effect, input, signal } from '@angular/core';
import { PointLight } from 'three';
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
  standalone: true,
  imports: [],
  providers: [provideObject3DComponent(PointLightComponent)],
})
export class PointLightComponent extends LightComponent {
  public override emoji = '💡';

  readonly distance = input<number>(0);
  readonly decay = input<number>(1);

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
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.light().dispose();
  }
}
