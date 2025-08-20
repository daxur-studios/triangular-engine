import { Component, effect, input, signal } from '@angular/core';
import {
  MaterialComponent,
  provideMaterialComponent,
} from './material.component';
import { LineBasicMaterial, LineBasicMaterialParameters } from 'three';

@Component({
  selector: 'lineBasicMaterial',
  template: `<ng-content></ng-content>`,
  standalone: true,
  providers: [provideMaterialComponent(LineBasicMaterialComponent)],
})
export class LineBasicMaterialComponent extends MaterialComponent {
  readonly params = input<LineBasicMaterialParameters>({});

  override material = signal(new LineBasicMaterial());

  constructor() {
    super();

    effect(
      () => {
        this.material().setValues(this.params());
        this.material().needsUpdate = true;
      },
      { allowSignalWrites: true },
    );
  }
}
