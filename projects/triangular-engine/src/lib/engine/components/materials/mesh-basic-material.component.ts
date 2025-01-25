import { Component, effect, inject, input, signal } from '@angular/core';
import { MeshBasicMaterialParameters, MeshBasicMaterial } from 'three';
import {
  MaterialComponent,
  provideMaterialComponent,
} from './material.component';
import { LoaderService } from '../../services';

@Component({
  selector: 'meshBasicMaterial',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideMaterialComponent(MeshBasicMaterialComponent)],
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

  /** Texture path */
  readonly map = input<string>();

  constructor() {
    super();

    this.#initMap();
  }

  #initMap() {
    effect(() => {
      const map = this.map();
      if (map) {
        this.loaderService.loadAndCacheTexture(map).then((texture) => {
          this.material().map = texture;
          this.material().needsUpdate = true;
        });
      }
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
