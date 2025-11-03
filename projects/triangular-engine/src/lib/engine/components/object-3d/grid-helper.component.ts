import { Component, effect, forwardRef, input, signal } from '@angular/core';

import { GridHelper } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';

/**
 * Example:
 * ```html
 * <gridHelper [size]="10" [divisions]="5" [color1]="'rgb(99, 99, 990)'" [color2]="'rgb(0, 99, 99)'" />
 * ```
 */
@Component({
  selector: 'gridHelper',
  template: `<ng-content></ng-content>`,
  imports: [],
  providers: [provideObject3DComponent(GridHelperComponent)],
})
export class GridHelperComponent extends Object3DComponent {
  public override emoji = '📐';

  readonly size = input<number>(10);
  readonly divisions = input<number>(5);

  readonly color1 = input<string>('rgb(99, 99, 990)');
  readonly color2 = input<string>('rgb(0, 99, 99)');

  override object3D = signal(new GridHelper());
  get grid() {
    return this.object3D;
  }

  private previousGrid: GridHelper | undefined = this.grid();

  constructor() {
    super();

    effect(() => {
      const prevGrid = this.previousGrid;
      if (prevGrid) {
        prevGrid.removeFromParent();
        prevGrid.dispose();
      }

      const size = this.size();
      const divisions = this.divisions();

      const grid = new GridHelper(
        size,
        divisions,
        this.color1(),
        this.color2(),
      );

      this.object3D.set(grid);

      // this.object3D.position.set(...position);

      this.previousGrid = grid;
    });
  }
}
