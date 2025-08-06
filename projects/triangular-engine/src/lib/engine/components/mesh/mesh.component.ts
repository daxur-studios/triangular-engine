import {
  Component,
  Injector,
  OnDestroy,
  OnInit,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

import { BufferGeometry, Material, Mesh } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';

@Component({
  standalone: true,
  selector: 'mesh',
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(MeshComponent)],
})
export class MeshComponent
  extends Object3DComponent
  implements OnDestroy, OnInit
{
  //#region Injected Dependencies
  readonly injector = inject(Injector);
  //#endregion

  override emoji = '🧇';

  readonly mesh = signal(new Mesh());

  readonly geometry = model<BufferGeometry | undefined>(undefined);
  readonly material = model<Material | undefined>(undefined);

  readonly receiveShadow = input<boolean>();
  readonly castShadow = input<boolean>();

  readonly renderOrder = input<number>();

  /** When this is true, the geometry will be computed and stored in a BVH tree for faster raycasting */
  readonly enableBVH = input<boolean>(false);

  override object3D = this.mesh;

  constructor() {
    super();

    this.#initSetMaterial();
    this.#initSetGeometry();

    this.#initSetReceiveShadow();
    this.#initSetCastShadow();

    this.#initRenderOrder();
  }

  #initSetMaterial() {
    effect(() => {
      const material = this.material();
      const mesh = this.mesh();
      if (material) {
        mesh.material = material;
      }
    });
  }

  #initSetGeometry() {
    effect(() => {
      const geometry = this.geometry();
      const mesh = this.mesh();
      if (geometry) {
        mesh.geometry = geometry;
        if (this.enableBVH()) {
          geometry.computeBoundsTree();
        }
      }
    });
  }

  #initRenderOrder() {
    effect(() => {
      const mesh = this.mesh();
      const renderOrder = this.renderOrder();
      if (mesh && renderOrder !== undefined) {
        mesh.renderOrder = renderOrder;
      }
    });
  }

  #initSetReceiveShadow() {
    effect(() => {
      const receiveShadow = this.receiveShadow();
      const mesh = this.mesh();

      mesh.receiveShadow = receiveShadow ?? false;
    });
  }

  #initSetCastShadow() {
    effect(() => {
      const castShadow = this.castShadow();
      const mesh = this.mesh();

      mesh.castShadow = castShadow ?? false;
    });
  }

  ngOnInit(): void {}

  override ngOnDestroy(): void {
    super.ngOnDestroy();
  }
}
