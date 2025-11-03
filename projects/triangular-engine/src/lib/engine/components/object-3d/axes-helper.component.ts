import { Component, effect, input, signal } from '@angular/core';

import { AxesHelper, Vector3Tuple } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
import { Css2dComponent } from '../css/css-2d.component';

const AXES_OPTIONS = [
  {
    label: 'X',
    position: [1, 0, 0],
  },
  {
    label: 'Y',
    position: [0, 1, 0],
  },
  {
    label: 'Z',
    position: [0, 0, 1],
  },
] satisfies { label: string; position: Vector3Tuple }[];

/**
 * Example:
 * ```html
 * <axesHelper [size]="10" [showLabels]="true" />
 * ```
 */
@Component({
  selector: 'axesHelper',
  template: `
    <ng-content></ng-content>
    @if (showLabels()) {
      @let _size = size();
      @for (option of AXES_OPTIONS; track option.label) {
        <css2d
          [position]="[
            option.position[0] * _size,
            option.position[1] * _size,
            option.position[2] * _size,
          ]"
        >
          <div class="axis-label">
            {{ option.label }}
          </div>
        </css2d>
      }
    }
  `,
  imports: [Css2dComponent],
  providers: [provideObject3DComponent(AxesHelperComponent)],
})
export class AxesHelperComponent extends Object3DComponent {
  public override emoji = '📍';

  readonly size = input<number>(5);
  readonly showLabels = input<boolean>(false);

  readonly AXES_OPTIONS = AXES_OPTIONS;

  override object3D = signal(new AxesHelper());
  get axes() {
    return this.object3D;
  }

  private previousAxes: AxesHelper | undefined = this.axes();

  constructor() {
    super();

    effect(() => {
      const prevAxes = this.previousAxes;
      if (prevAxes) {
        prevAxes.removeFromParent();
        prevAxes.dispose();
      }

      const size = this.size();
      const axes = new AxesHelper(size);

      this.object3D.set(axes);

      this.previousAxes = axes;
    });
  }
}
