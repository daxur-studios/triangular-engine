import {
  Component,
  effect,
  model,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  Object3DComponent,
  provideObject3DComponent,
} from './object-3d.component';
import {
  BufferGeometry,
  Material,
  Object3D,
  Object3DEventMap,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector2Tuple,
} from 'three';

@Component({
  selector: 'sprite',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(SpriteComponent)],
})
export class SpriteComponent extends Object3DComponent {
  readonly sprite = signal(new Sprite());
  override readonly object3D = this.sprite;

  readonly material = model<SpriteMaterial | undefined>(undefined);
  readonly center = model<Vector2Tuple | undefined>(undefined);

  constructor() {
    super();

    this.#initSetMaterial();
    this.#initSetCenter();
  }

  #initSetCenter() {
    effect(() => {
      const center = this.center();
      const sprite = this.sprite();
      if (center) {
        sprite.center = new Vector2(...center);
      }
    });
  }
  #initSetMaterial() {
    effect(() => {
      const material = this.material();
      const sprite = this.sprite();
      if (material) {
        sprite.material = material;
      }
    });
  }
}
