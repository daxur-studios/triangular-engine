import {
  Component,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  InputSignal,
  model,
  OnDestroy,
  OnInit,
  Provider,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  Material,
  MaterialParameters,
  MeshNormalMaterial,
  MeshNormalMaterialParameters,
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  RawShaderMaterial,
  RepeatWrapping,
  ShaderMaterial,
  ShaderMaterialParameters,
  Texture,
} from 'three';

import { toObservable } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { EngineService, LoaderService, MaterialService } from '../../services';
import { Object3DComponent } from '../object-3d/object-3d.component';
import { handleMaterialAndGeometryLinking, IMaterialComponent } from '../util';

export function provideMaterialComponent<T extends typeof MaterialComponent>(
  component: T,
): Provider {
  return {
    provide: MaterialComponent,
    useExisting: component,
  };
}

@Component({
  selector: 'material',
  standalone: true,
  template: `<ng-content></ng-content>`,
})
export abstract class MaterialComponent
  implements OnInit, OnDestroy, IMaterialComponent
{
  //#region Injected Dependencies

  readonly engineService = inject(EngineService);
  readonly injector = inject(Injector);
  readonly materialService = inject(MaterialService);
  readonly parent = inject(Object3DComponent, {
    skipSelf: true,
  });
  readonly destroyRef = inject(DestroyRef);
  //#endregion

  abstract params: InputSignal<MaterialParameters>;
  abstract material: WritableSignal<Material>;
  readonly material$ = new Subject<Material>();
  readonly name = input<string>();

  /**
   * If set, it adds this material to the shared materials map
   * If material already exists under the key, it will re-use it instead of creating a new one
   */
  readonly shareMaterialKey = input<string>();
  readonly shareMaterialKey$ = toObservable(this.shareMaterialKey);

  constructor() {
    this.#initMaterialObservable();

    this.#initUpdateMaterial();
    this.#initCastAndSetMaterial();
    this.#initSetName();
  }

  ngOnInit(): void {
    this.#initShareMaterial();
  }

  #initMaterialObservable() {
    effect(() => {
      this.material$.next(this.material());
    });
  }

  #initShareMaterial() {
    effect(
      () => {
        const material = this.material();
        const key = this.shareMaterialKey();

        if (key && material) {
          const existingMaterial = this.materialService.getMaterial(key);
          if (existingMaterial && existingMaterial.uuid !== material.uuid) {
            this.material.set(existingMaterial);
            material.dispose();
          } else {
            this.materialService.setMaterial(key, material);
          }
        }
      },
      { injector: this.injector },
    );
  }

  #initUpdateMaterial() {
    effect(() => {
      this.updateFromParameters(this.params(), this.material());
    });
  }

  #initCastAndSetMaterial() {
    effect(() => {
      handleMaterialAndGeometryLinking(this.material(), this.parent);
    });
  }

  #initSetName() {
    effect(() => {
      const material = this.material();
      const name = this.name();
      if (name && material) {
        material.name = name;
      }
    });
  }

  updateFromParameters(parameters: MaterialParameters, material: Material) {
    material.setValues(parameters);
    material.needsUpdate = true;

    this.material.set(material);
  }

  ngOnDestroy(): void {
    this.material()?.dispose();
  }
}

@Component({
  selector: 'meshStandardMaterial',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideMaterialComponent(MeshStandardMaterialComponent)],
})
export class MeshStandardMaterialComponent extends MaterialComponent {
  //#region Injected Dependencies
  readonly loaderService = inject(LoaderService);
  //#endregion

  override readonly params = model<MeshStandardMaterialParameters>({});

  /** Texture path or Texture object */
  readonly map = input<string | Texture>();
  readonly alphaMap = input<string>();
  /** Flip the map vertically at the sampler level */
  readonly mapFlipY = input<boolean>();

  override readonly material = signal(new MeshStandardMaterial());

  constructor() {
    super();

    this.#initMap();
    this.#initAlphaMap();
  }

  #initMap() {
    effect(async () => {
      const mapInput = this.map();
      const flipY = this.mapFlipY();

      let texture: Texture | undefined;
      if (typeof mapInput === 'string') {
        texture = await this.loaderService.loadAndCacheTexture(mapInput);
      } else {
        texture = mapInput;
      }

      if (texture) {
        if (flipY) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.repeat.set(1, -1);
          texture.offset.set(0, 1);
          texture.needsUpdate = true;
        }
        this.material().map = texture;
        this.material().needsUpdate = true;
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

@Component({
  selector: 'meshNormalMaterial',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideMaterialComponent(MeshNormalMaterialComponent)],
})
export class MeshNormalMaterialComponent extends MaterialComponent {
  readonly params = input<MeshNormalMaterialParameters>({});
  public override material = signal(new MeshNormalMaterial());

  constructor() {
    super();
  }
}

@Component({
  selector: 'shaderMaterial',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideMaterialComponent(ShaderMaterialComponent)],
})
export class ShaderMaterialComponent extends MaterialComponent {
  readonly params = input<ShaderMaterialParameters>({});

  public override material = signal(new ShaderMaterial());

  constructor() {
    super();
  }
}

@Component({
  selector: 'rawShaderMaterial',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideMaterialComponent(RawShaderMaterialComponent)],
})
export class RawShaderMaterialComponent extends MaterialComponent {
  readonly params = input<ShaderMaterialParameters>({});

  public override material = signal(new RawShaderMaterial());

  constructor() {
    super();
  }
}
