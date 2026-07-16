import { Component, effect, inject, input, signal } from '@angular/core';
import {
  MeshBasicMaterialParameters,
  MeshBasicMaterial,
  Texture,
} from 'three';
import {
  MaterialComponent,
  provideMaterialComponent,
} from './material.component';
import { LoaderService } from '../../services';

@Component({
    selector: 'meshBasicMaterial',
    template: `<ng-content></ng-content>`,
    imports: [],
    providers: [provideMaterialComponent(MeshBasicMaterialComponent)]
})
export class MeshBasicMaterialComponent extends MaterialComponent {
  //#region Injected Dependencies
  readonly loaderService = inject(LoaderService);
  //#endregion

  // Define default parameters for MeshBasicMaterial
  override readonly params = input<MeshBasicMaterialParameters>({
    color: 0xffffff, // Default to white; will be overridden by texture
    side: 0, // FrontSide by default; we'll set to BackSide in BackgroundSphereComponent
  });

  // Initialize MeshBasicMaterial
  override readonly material = signal(new MeshBasicMaterial());

  /** Texture path or caller-owned texture. */
  readonly map = input<string | Texture>();
  /** Optional opacity map path or caller-owned texture. */
  readonly alphaMap = input<string | Texture>();

  constructor() {
    super();

    this.#initMap();
    this.#initAlphaMap();
  }

  #initMap() {
    effect(async () => {
      const map = this.map();
      if (!map) return;
      const texture =
        typeof map === 'string'
          ? await this.loaderService.loadAndCacheTexture(map)
          : map;
      this.material().map = texture;
      this.material().needsUpdate = true;
    });
  }

  #initAlphaMap() {
    effect(async () => {
      const alphaMap = this.alphaMap();
      if (!alphaMap) return;
      const texture =
        typeof alphaMap === 'string'
          ? await this.loaderService.loadAndCacheTexture(alphaMap)
          : alphaMap;
      this.material().alphaMap = texture;
      this.material().needsUpdate = true;
    });
  }

  // Override to handle additional parameters if needed
  override updateFromParameters(
    parameters: MeshBasicMaterialParameters,
    material: MeshBasicMaterial
  ): void {
    super.updateFromParameters(parameters, material);
    // Additional parameter handling can be added here
  }
}
