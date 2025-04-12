import {
  AfterContentInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  TemplateRef,
  WritableSignal,
  contentChild,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';

@Component({
  selector: 'css2d',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(Css2dComponent)],
})
export class Css2dComponent
  extends Object3DComponent
  implements OnDestroy, OnInit, AfterContentInit
{
  override emoji = '📄';
  override readonly object3D = signal<CSS2DObject>(undefined!);
  get css2d() {
    return this.object3D;
  }

  constructor(private readonly elementRef: ElementRef) {
    super();
  }

  ngOnInit() {}
  ngAfterContentInit() {
    this.css2d.set(new CSS2DObject(this.elementRef.nativeElement));

    //this.engineService.scene.add(this.css2d());
    this.css2d().position.set(0, 0, 0);
  }
  override ngOnDestroy(): void {
    super.ngOnDestroy();
    if (this.css2d) {
      this.engineService.scene.remove(this.css2d());
    }
  }
}
