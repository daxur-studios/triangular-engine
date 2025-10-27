import { Component, input, signal } from '@angular/core';

import { IcosahedronGeometry } from 'three';
import {
  BufferGeometryComponent,
  provideBufferGeometryComponent,
} from './geometry.component';

type IcosahedronGeometryParameters = ConstructorParameters<
  typeof IcosahedronGeometry
>;

@Component({
  selector: 'icosahedronGeometry',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideBufferGeometryComponent(IcosahedronGeometryComponent)],
})
export class IcosahedronGeometryComponent extends BufferGeometryComponent {
  /**
   * [radius, detail]
   */
  override readonly params = input<IcosahedronGeometryParameters>([]);

  override readonly geometry = signal(new IcosahedronGeometry());
  override previousGeometry: IcosahedronGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(
    parameters: IcosahedronGeometryParameters,
  ): IcosahedronGeometry {
    return new IcosahedronGeometry(...parameters);
  }
}
