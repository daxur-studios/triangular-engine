import {
  Component,
  DestroyRef,
  OnDestroy,
  Provider,
  Type,
  WritableSignal,
  effect,
  forwardRef,
  inject,
  model,
} from '@angular/core';
import { EngineService, MaterialService } from '../../services';

import { Subject } from 'rxjs';
import { EulerTuple, Object3D, Vector3Tuple } from 'three';

/**
 * Provides a provider for Object3DComponent or any subclass of it.
 *
 * @param component The component class that extends Object3DComponent.
 * @returns A Provider object for Angular's dependency injection.
 */
export function provideObject3DComponent<T extends Object3DComponent>(
  component: Type<T>,
): Provider {
  return {
    provide: Object3DComponent,
    useExisting: forwardRef(() => component),
  };
}

@Component({
  standalone: true,
  selector: 'object3d',
  template: `<ng-content></ng-content>`,
  providers: [],
})
export abstract class Object3DComponent implements OnDestroy {
  static InstanceCounts = new Map<string, number>();

  //#region Injected Dependencies
  readonly engineService = inject(EngineService);
  readonly materialService = inject(MaterialService);
  readonly destroyRef = inject(DestroyRef);

  readonly parent = inject(Object3DComponent, {
    skipSelf: true,
    optional: true,
  });

  //#endregion

  // readonly _viewChildren = viewChildren(Object3DComponent);
  // readonly _contentChildren = contentChildren(Object3DComponent);

  // readonly children = computed(() => [
  //   ...this._viewChildren(),
  //   ...this._contentChildren(),
  // ]);

  readonly position = model<Vector3Tuple>([0, 0, 0]);
  readonly scale = model<Vector3Tuple | number>(1);
  readonly rotation = model<EulerTuple>([0, 0, 0]);

  readonly name = model<string>('');

  public emoji = '';

  abstract object3D: WritableSignal<Object3D>;

  readonly destroy$ = new Subject<void>();
  constructor() {
    this.#initNamingAndInstanceCounts();

    this.#initSetPosition();
    this.#initSetRotation();
    this.#initSetScale();

    this.#initSetName();
    this.#initAttachToParent();

    this.#initSetObject3DUserData();
  }

  #initSetObject3DUserData() {
    effect(() => {
      const object3D = this.object3D();
      if (object3D) {
        object3D.userData ||= {};
        object3D.userData['object3DComponent'] = this;
      }
    });
  }

  #initSetPosition() {
    effect(() => {
      const object3D = this.object3D();
      const position = this.position();
      if (!object3D) return;
      object3D.position.set(...position);
    });
  }
  #initSetRotation() {
    effect(() => {
      const object3D = this.object3D();
      const rotation = this.rotation();
      if (!object3D) return;
      object3D.rotation.set(...rotation);
    });
  }
  #initSetScale() {
    effect(() => {
      const scale = this.scale();
      const object3D = this.object3D();
      if (!object3D) return;

      if (typeof scale === 'number') {
        object3D.scale.set(scale, scale, scale);
      } else {
        object3D.scale.set(...scale);
      }
    });
  }

  #initSetName() {
    effect(() => {
      const object3D = this.object3D();
      const name = this.name();
      if (name && object3D) {
        object3D.name = name;
      }
    });
  }
  #initAttachToParent() {
    effect(() => {
      const object3D = this.object3D();
      if (!object3D) return;

      if (this.parent && this.#isSameSceneAsParent(this.parent)) {
        this.parent.object3D().add(this.object3D());
      } else {
        this.engineService.scene.add(this.object3D());
      }
    });
  }

  /**
   * Returns true when the parent's scene is different to the closest EngineService.scene
   * Fix edge case where a <scene> is placed inside another <scene>, and otherwise it's objects would be parented to the outer scene.
   */
  #isSameSceneAsParent(parent: Object3DComponent): boolean {
    return parent.engineService.scene === this.engineService.scene;
  }

  #initNamingAndInstanceCounts() {
    const shortName = this.constructor.name
      .replace('Component', '')
      .replaceAll('_', '');
    //#region Static Instance Counts
    Object3DComponent.InstanceCounts.set(
      'Object3DComponent',
      (Object3DComponent.InstanceCounts.get('Object3DComponent') || 0) + 1,
    );
    Object3DComponent.InstanceCounts.set(
      shortName,
      (Object3DComponent.InstanceCounts.get(shortName) || 0) + 1,
    );

    this.name.set(
      `${shortName} ${Object3DComponent.InstanceCounts.get(shortName)}`,
    );
    //#endregion
  }
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (this.parent?.object3D()) {
      this.parent.object3D().remove(this.object3D());
    } else {
      this.engineService.scene.remove(this.object3D());
    }
  }
}
