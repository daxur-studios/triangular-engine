import { Component, effect, inject, input, signal } from '@angular/core';
import { Object3DComponent, provideObject3DComponent } from '../object-3d';
import { Object3D, Scene } from 'three';
import { BehaviorSubject } from 'rxjs';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LoaderService } from '../../services';
import { buildGraph } from '../../models';

@Component({
  selector: 'gltf',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(GltfComponent)],
})
export class GltfComponent extends Object3DComponent {
  //#region Injected Dependencies
  readonly loaderService = inject(LoaderService);
  //#endregion

  readonly gltfPath = input.required<string>();
  /**
   * Whether to cache the GLTF to a different path than the one provided in the gltfPath input.
   */
  readonly cachePath = input<string | undefined>(undefined);

  readonly object3D = signal(new Object3D());

  readonly gltf$ = new BehaviorSubject<GLTF | undefined>(undefined);

  constructor() {
    super();

    // Load the GLTF file when the path changes
    effect(() => {
      this.#loadAndCache(this.gltfPath(), this.cachePath());
    });
  }

  async #loadAndCache(gltfPath: string | undefined, cachePath?: string) {
    if (gltfPath) {
      const gltf = await this.loaderService.loadAndCacheGltf(
        gltfPath,
        cachePath,
      );

      this.gltf$.next(gltf);
      if (gltf) {
        this.object3D.set(gltf.scene);
        this.gltf$.next(gltf);
        // console.warn('GLTF loaded:', gltf);
      }
    }
  }
}
