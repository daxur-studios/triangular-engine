import { Component, input, signal } from '@angular/core';
import {
  MaterialComponent,
  provideMaterialComponent,
} from './material.component';
import { PointsMaterial, PointsMaterialParameters } from 'three';

@Component({
  selector: 'pointsMaterial',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  styles: ``,
  providers: [provideMaterialComponent(PointsMaterialComponent)],
})
export class PointsMaterialComponent extends MaterialComponent {
  readonly params = input<PointsMaterialParameters>({});

  readonly material = signal(new PointsMaterial());
}
