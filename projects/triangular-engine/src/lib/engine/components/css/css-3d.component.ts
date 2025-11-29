import {
  AfterContentInit,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  TemplateRef,
  WritableSignal,
  contentChild,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  CSS3DObject,
  CSS3DSprite,
} from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { Vector3, Vector3Tuple } from 'three';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'css3d',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(Css3dComponent)],
})
export class Css3dComponent
  extends Object3DComponent
  implements OnDestroy, OnInit, AfterContentInit
{
  readonly injector = inject(Injector);

  override emoji = '📄';
  override readonly object3D = signal<CSS3DObject | CSS3DSprite>(undefined!);
  get css3d() {
    return this.object3D;
  }

  readonly type = input<'CSS3DObject' | 'CSS3DSprite'>('CSS3DObject');
  /**
   * Scale factor for the CSS3D object.
   * CSS3D objects are sized in pixels, so they can appear very large in the 3D scene.
   * Default is 0.01 (1px = 0.01 3D units)
   */
  override readonly scale = model<number | Vector3Tuple>(0.01);

  constructor(private readonly elementRef: ElementRef) {
    super();
  }

  ngOnInit() {
    this.#initObject3D();
  }

  ngAfterContentInit() {
    // Object creation is handled in the effect
  }

  #initObject3D() {
    effect(
      () => {
        const type = this.type();
        const element = this.elementRef.nativeElement;

        // Remove existing object from scene if it exists
        const currentObject = untracked(() => this.css3d());
        if (currentObject) {
          this.engineService.scene.remove(currentObject);
        }

        // Create new object based on type
        let newObject: CSS3DObject | CSS3DSprite;
        if (type === 'CSS3DSprite') {
          newObject = new CSS3DSprite(element);
        } else {
          newObject = new CSS3DObject(element);
        }

        this.css3d.set(newObject);
        this.engineService.scene.add(newObject);
      },
      { injector: this.injector },
    );
  }
  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.engineService.scene.remove(this.css3d());
  }
}
