import { Component, input, signal } from '@angular/core';

import { CapsuleGeometry } from 'three';
import {
  BufferGeometryComponent,
  provideBufferGeometryComponent,
} from './geometry.component';

type CapsuleGeometryParameters = ConstructorParameters<typeof CapsuleGeometry>;

@Component({
    selector: 'capsuleGeometry',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideBufferGeometryComponent(CapsuleGeometryComponent)]
})
export class CapsuleGeometryComponent extends BufferGeometryComponent {
  override readonly params = input<CapsuleGeometryParameters>([]);

  override readonly geometry = signal(new CapsuleGeometry());
  override previousGeometry: CapsuleGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(
    parameters: CapsuleGeometryParameters,
  ): CapsuleGeometry {
    return new CapsuleGeometry(...parameters);
  }
}
