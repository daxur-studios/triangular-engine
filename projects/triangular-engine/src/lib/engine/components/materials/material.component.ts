import {
  Component,
  InputSignal,
  OnDestroy,
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
import { EngineService, LoaderService } from '../../services';
import { PointsComponent } from '../particle';
import { InstancedMeshComponent } from '../mesh';
import { InstancedRigidBodyComponent } from '../physics';
import { LineComponent } from '../curve/line.component';
import { SpriteComponent } from '../object-3d/sprite.component';
import { handleMaterialAndGeometryLinking } from '../util';

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
export abstract class MaterialComponent implements OnDestroy {
  //#region Injected Dependencies

  readonly engineService = inject(EngineService);
  readonly parent = inject(Object3DComponent, {
    skipSelf: true,
  });

  //#endregion

  abstract params: InputSignal<MaterialParameters>;
  abstract material: WritableSignal<Material>;
  readonly name = input<string>();

  constructor() {
    this.#initUpdateMaterial();
    this.#initCastAndSetMaterial();
    this.#initSetName();
  }

  #initUpdateMaterial() {
    effect(
      () => {
        this.updateFromParameters(this.params(), this.material());
      },
      { allowSignalWrites: true },
    );
  }

  #initCastAndSetMaterial() {
    effect(
      () => {
        handleMaterialAndGeometryLinking(this.material(), this.parent);

        // const material = this.material();
        // // Cast to MeshComponent to see if it should be added to the mesh
        // if (this.parent instanceof MeshComponent) {
        //   this.parent.material.set(material);
        //   this.parent.mesh().material = material;
        // }
        // // Cast to PointsComponent to see if it should be added to the points
        // else if (this.parent instanceof PointsComponent) {
        //   this.parent.material.set(material);
        //   this.parent.points().material = material;
        // } else if (this.parent instanceof InstancedMeshComponent) {
        //   this.parent.material.set(material);
        //   this.parent.instancedMesh().material = material;
        // } else if (this.parent instanceof InstancedRigidBodyComponent) {
        //   this.parent.material.set(material);
        // } else if (this.parent instanceof LineComponent) {
        //   this.parent.material.set(material);
        // } else if (this.parent instanceof SpriteComponent) {
        //   this.parent.material.set(material);
        // }
      },
      { allowSignalWrites: true },
    );
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
  selector: 'mesh-standard-material',
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

  override readonly material = signal(new MeshStandardMaterial());

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
}

@Component({
  selector: 'mesh-normal-material',
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
  selector: 'shader-material',
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
  selector: 'raw-shader-material',
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
