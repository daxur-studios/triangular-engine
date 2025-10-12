import {
  Component,
  DestroyRef,
  Injector,
  InputSignal,
  OnDestroy,
  OnInit,
  Provider,
  WritableSignal,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import {
  BufferGeometry,
  Material,
  MaterialParameters,
  MeshNormalMaterial,
  MeshNormalMaterialParameters,
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  RawShaderMaterial,
  ShaderMaterial,
  ShaderMaterialParameters,
} from 'three';

import { MeshComponent } from '../mesh/mesh.component';
import { Object3DComponent } from '../object-3d/object-3d.component';
import { EngineService, LoaderService, MaterialService } from '../../services';
import { PointsComponent } from '../particle';
import { InstancedMeshComponent } from '../mesh';
import { InstancedRigidBodyComponent } from '../physics';
import { LineComponent } from '../curve/line.component';
import { SpriteComponent } from '../object-3d/sprite.component';
import { handleMaterialAndGeometryLinking } from '../util';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, Observable, Subject } from 'rxjs';

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
export abstract class MaterialComponent implements OnInit, OnDestroy {
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

  /** Texture path */
  readonly map = input<string>();
  readonly alphaMap = input<string>();

  override readonly material = signal(new MeshStandardMaterial());

  constructor() {
    super();

    this.#initMap();
    this.#initAlphaMap();
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
