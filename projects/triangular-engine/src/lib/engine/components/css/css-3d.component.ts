import {
  AfterContentInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  TemplateRef,
  WritableSignal,
  contentChild,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { Vector3, Vector3Tuple } from 'three';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'css-3d',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(Css3dComponent)],
})
export class Css3dComponent
  extends Object3DComponent
  implements OnDestroy, OnInit, AfterContentInit
{
  override emoji = '📄';
  override readonly object3D = signal<CSS3DObject>(undefined!);
  get css3d() {
    return this.object3D;
  }

  readonly upVector = input<Vector3Tuple>();

  constructor(private readonly elementRef: ElementRef) {
    super();

    this.#initUpVector();

    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const css3d = this.css3d();
        const upVector = this.upVector();
        const camera = this.engineService.camera;

        if (css3d) {
          css3d.lookAt(camera.position);
          //css3d.rotation.x = 0;
          //css3d.rotation.y = 0;
          //css3d.rotation.z = 0;
        }
      });
  }

  #initUpVector() {
    effect(() => {
      const upVector = this.upVector();
      const css3d = this.css3d();
      if (upVector && css3d) {
        css3d.up.set(...upVector);
        // Force the object to reorient itself based on the new up vector
        css3d.lookAt(css3d.getWorldPosition(new Vector3()).add(css3d.up));
      }
    });
  }

  ngOnInit() {}
  ngAfterContentInit() {
    this.css3d.set(new CSS3DObject(this.elementRef.nativeElement));
  }
  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.engineService.scene.remove(this.css3d());
  }
}
