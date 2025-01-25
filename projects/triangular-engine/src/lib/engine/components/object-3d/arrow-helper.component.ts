import { Component, effect, input, signal } from '@angular/core';

import { ArrowHelper, ColorRepresentation, Vector3 } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
import { xyz } from '../../models';

type ArrowHelperParameters = {
  //dir?: xyz;
  origin?: xyz;
  // length?: number;
  // color?: ColorRepresentation;
  headLength?: number;
  headWidth?: number;
};

@Component({
  selector: 'arrowHelper',
  template: `<ng-content></ng-content> `,

  standalone: true,
  imports: [],
  providers: [provideObject3DComponent(ArrowHelperComponent)],
})
export class ArrowHelperComponent extends Object3DComponent {
  public override emoji = '🏹';

  //  readonly params = input<ArrowHelperParameters>();

  readonly length = input.required<number>();
  readonly direction = input.required<xyz>();
  readonly color = input<ColorRepresentation>('red');

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

    // effect(
    //   () => {
    //     const params = this.params();
    //     if (!params) return;

    //     const prevArrow = this.previousArrow;
    //     if (prevArrow) {
    //       //    prevArrow.dispose();
    //       //  prevArrow.removeFromParent();
    //     }

    //     const arrow = new ArrowHelper(
    //       new Vector3(...this.direction()).normalize(),
    //       undefined,
    //       // new Vector3(...(params?.origin || [0, 0, 0])),
    //       this.length(),
    //       this.color(),
    //       params.headLength,
    //       params.headWidth,
    //     );
    //     console.warn('arrow', arrow, this.parent?.object3D());
    //     this.object3D.set(arrow);
    //     this.parent?.object3D().add(arrow);
    //     this.previousArrow = arrow;
    //   },
    //   { allowSignalWrites: true },
    // );
  }
}
