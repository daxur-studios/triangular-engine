import { Component, effect, inject, input, signal } from '@angular/core';
import {
  SpriteMaterial,
  SpriteMaterialParameters,
  SRGBColorSpace,
} from 'three';
import {
  MaterialComponent,
  provideMaterialComponent,
} from './material.component';
import { LoaderService } from '../../services';

@Component({
  selector: 'spriteMaterial',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideMaterialComponent(SpriteMaterialComponent)],
})
export class SpriteMaterialComponent extends MaterialComponent {
  //#region Injected Dependencies
  readonly loaderService = inject(LoaderService);
  //#endregion

  readonly params = input<SpriteMaterialParameters>({});

  readonly map = input<string>();
  readonly alphaMap = input<string>();
  /**The rotation of the sprite in radians. */
  readonly rotation = input<number>();

  override readonly material = signal(new SpriteMaterial());

  constructor() {
    super();
    this.#initMap();
    this.#initAlphaMap();
    this.#initRotation();
  }

  #initRotation() {
    effect(() => {
      const rotation = this.rotation();
      const material = this.material();

      if (rotation || rotation === 0) {
        material.rotation = rotation;
        material.needsUpdate = true;
      }
    });
  }

  #initMap() {
    effect(() => {
      const map = this.map();

      if (map) {
        this.loaderService.loadAndCacheTexture(map).then((texture) => {
          this.material().map = texture;
          this.material().needsUpdate = true;
          this.material().transparent = true;

          texture.colorSpace = SRGBColorSpace;
        });
      }
    });
  }
  #initAlphaMap() {
    effect(() => {
      const alphaMap = this.alphaMap();
      if (alphaMap) {
        this.loaderService.loadAndCacheTexture(alphaMap).then((texture) => {
          this.material().alphaMap = texture;
          this.material().needsUpdate = true;
        });
      }
    });
  }
}
