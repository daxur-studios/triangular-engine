import {
  AfterContentInit,
  Component,
  Injector,
  OnDestroy,
  OnInit,
  SkipSelf,
  computed,
  contentChild,
  contentChildren,
  effect,
  forwardRef,
  inject,
  input,
  model,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';

import { BufferGeometry, Group, Material, Mesh } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d/object-3d.component';
import { MaterialComponent } from '../materials/material.component';
import { BufferGeometryComponent } from '../geometry/geometry.component';
import { IPhysicsOptions } from '../../models';
import { PhysicsService } from '../../services';

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
  readonly physicsService = inject(PhysicsService);
  readonly injector = inject(Injector);
  //#endregion

  override emoji = '🧇';

  readonly mesh = signal(new Mesh());

  readonly geometry = model<BufferGeometry | undefined>(undefined);
  readonly material = model<Material | undefined>(undefined);

  readonly renderOrder = input<number>();

  override object3D = this.mesh;

  constructor() {
    super();

    this.#initSetMaterial();
    this.#initSetGeometry();
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

  ngOnInit(): void {
    //#region Physics
    // effect(
    //   () => {
    //     const physics = this.physics();
    //     const mesh = this.mesh();
    //     const geometry = this.geometry();
    //     if (mesh && geometry) {
    //       mesh.geometry = geometry;
    //     }
    //     if (physics && mesh && mesh.geometry && geometry) {
    //       //this.physicsService.addRigidBody(mesh, physics);
    //       this.addRigidBody(physics, mesh);
    //     }
    //   },
    //   { injector: this.injector },
    // );
    //#endregion
  }

  addRigidBody(physics: IPhysicsOptions, mesh: Mesh) {
    this.physicsService.addRigidBody(mesh, physics);
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();

    // if (this.physics()) {
    //   this.physicsService.removeRigidBody(this.mesh());
    // }
  }
}
