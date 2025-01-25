import { Component, signal } from '@angular/core';

import { Group } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';

@Component({
  selector: 'group',
  template: `<ng-content></ng-content> `,

  standalone: true,
  imports: [],
  providers: [provideObject3DComponent(GroupComponent)],
})
export class GroupComponent extends Object3DComponent {
  public override emoji = '👥';

  override readonly object3D = signal(new Group());
  get group() {
    return this.object3D;
  }

  constructor() {
    super();
  }
}
