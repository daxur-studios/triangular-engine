import { Component, effect, input, signal } from '@angular/core';

import { ArrowHelper, ColorRepresentation, Material, Vector3, Vector3Tuple } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';

type ArrowHelperParameters = {
  //dir?: xyz;
  origin?: Vector3Tuple;
  // length?: number;
  // color?: ColorRepresentation;
  headLength?: number;
  headWidth?: number;
};

/**
 * @example
 * <arrowHelper [length]="10" [direction]="[1, 0, 0]" [color]="'red'" />
 */
@Component({
  selector: 'arrowHelper',
  template: `<ng-content></ng-content> `,
  imports: [],
  providers: [provideObject3DComponent(ArrowHelperComponent)],
})
export class ArrowHelperComponent extends Object3DComponent {
  public override emoji = '🏹';

  //  readonly params = input<ArrowHelperParameters>();

  readonly length = input.required<number>();
  readonly direction = input.required<Vector3Tuple>();
  readonly color = input<ColorRepresentation>('red');
  readonly depthTest = input<boolean>(true);

  readonly arrow = signal<ArrowHelper>(new ArrowHelper());
  override object3D = this.arrow;

  private previousArrow: ArrowHelper | undefined = this.arrow();

  constructor() {
    super();

    effect(() => {
      this.arrow().setDirection(new Vector3(...this.direction()).normalize());
    });
    effect(() => {
      this.arrow().setLength(this.length());
    });
    effect(() => {
      this.arrow().setColor(this.color());
    });
    effect(() => {
      const dt = this.depthTest();
      const arrow = this.arrow();
      const setDepthTest = (mat: Material | Material[] | undefined) => {
        if (Array.isArray(mat)) {
          for (const m of mat) m.depthTest = dt;
        } else if (mat) {
          mat.depthTest = dt;
        }
      };
      setDepthTest(arrow.line.material);
      setDepthTest(arrow.cone.material);
      if (!dt) {
        arrow.line.renderOrder = 999;
        arrow.cone.renderOrder = 999;
        arrow.renderOrder = 999;
      }
    });
  }
}
