import { Component, effect, inject, input, signal } from '@angular/core';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { Mesh, Object3D, Scene } from 'three';
import { BehaviorSubject, combineLatest, distinctUntilChanged } from 'rxjs';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LoaderService } from '../../services';
import { buildGraph } from '../../models';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

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
  readonly gltfPath$ = toObservable(this.gltfPath);
  /**
   * Whether to cache the GLTF to a different path than the one provided in the gltfPath input.
   */
  readonly cachePath = input<string | undefined>(undefined);
  readonly cachePath$ = toObservable(this.cachePath);

  /** When this is true, the geometry will be computed and stored in a BVH tree for faster raycasting for every mesh in this gltf */
  readonly enableBVH = input<boolean>(false);
  readonly enableBVH$ = toObservable(this.enableBVH);

  readonly castShadow = input<boolean>(false);
  readonly castShadow$ = toObservable(this.castShadow);
  readonly receiveShadow = input<boolean>(false);
  readonly receiveShadow$ = toObservable(this.receiveShadow);

  readonly object3D = signal(new Object3D());

  readonly gltf$ = new BehaviorSubject<GLTF | undefined>(undefined);

  constructor() {
    super();

    // Load the GLTF file when the path changes
    effect(() => {
      this.#loadAndCache(this.gltfPath(), this.cachePath());
    });

    this.#initReCacheOnGltfPathChange();
    this.#initEnableBVH();
    this.#initCastShadow();
  }

  #initEnableBVH() {
    combineLatest([this.enableBVH$, this.gltf$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([enableBVH, gltf]) => {
        if (enableBVH && gltf) {
          gltf.scene.traverse((child) => {
            if (
              child instanceof Mesh &&
              typeof child.geometry.computeBoundsTree === 'function'
            ) {
              console.log('🧊 I am computing BVH for Gltf sub-mesh');
              child.geometry.computeBoundsTree();
            }
          });
        }
      });
  }

  #initCastShadow() {
    combineLatest([this.castShadow$, this.receiveShadow$, this.gltf$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([castShadow, receiveShadow, gltf]) => {
        if (gltf) {
          gltf.scene.traverse((child) => {
            if (child instanceof Mesh) {
              child.castShadow = castShadow;
              child.receiveShadow = receiveShadow;
            }
          });
        }
      });
  }

  async #loadAndCache(
    gltfPath: string | undefined,
    cachePath?: string,
    force = false,
  ) {
    if (gltfPath) {
      const gltf = await this.loaderService.loadAndCacheGltf(
        gltfPath,
        cachePath,
        force,
      );

      this.gltf$.next(gltf);
      if (gltf) {
        this.object3D.set(gltf.scene);
        this.gltf$.next(gltf);
        // console.warn('GLTF loaded:', gltf);
      }
    }
  }

  #initReCacheOnGltfPathChange() {
    this.gltfPath$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged((previous, current) => {
          // Only interested in additional changes, where both a and b are defined
          return previous !== current && !!previous && !!current;
        }),
      )
      .subscribe((gltfPath) => {
        if (!this.cachePath()) {
          return;
        }

        console.log('Re-caching GLTF now', gltfPath);
        this.#loadAndCache(gltfPath, this.cachePath(), true);
      });
  }
}
