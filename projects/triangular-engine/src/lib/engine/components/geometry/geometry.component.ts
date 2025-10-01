import {
  Component,
  DestroyRef,
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
  BoxGeometry,
  BufferGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusKnotGeometry,
} from 'three';

import { MeshComponent } from '../mesh/mesh.component';
import { PointsComponent } from '../particle';
import { Object3DComponent } from '../object-3d';
import { InstancedMeshComponent } from '../mesh';
import { InstancedRigidBodyComponent } from '../physics';
import { LineComponent } from '../curve/line.component';
import { handleMaterialAndGeometryLinking } from '../util';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

export function provideBufferGeometryComponent(component: any): Provider {
  return {
    provide: BufferGeometryComponent,
    useExisting: component,
  };
}

@Component({
  selector: 'bufferGeometry',
  template: `<ng-content></ng-content>`,

  standalone: true,
  imports: [],
  providers: [],
})
export class BufferGeometryComponent implements OnDestroy {
  //#region Injected Dependencies
  readonly parent = inject(Object3DComponent, {
    skipSelf: true,
  });
  readonly destroyRef = inject(DestroyRef);
  //#endregion

  readonly params = input<any>();
  readonly name = input<string>();

  /**
   * Useful when you get warning like this:
   * `THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.`
   * Eg when dynamically creating larger lines
   */
  readonly reCreateGeometryTrigger = input<any>();
  readonly reCreateGeometryTrigger$ = toObservable(
    this.reCreateGeometryTrigger,
  );

  readonly geometry: WritableSignal<BufferGeometry> = model(
    new BufferGeometry(),
  );
  previousGeometry: BufferGeometry | undefined;

  emoji = '🌐';

  constructor() {
    this.#initUpdateGeometry();
    this.#initSetName();
    this.#iniCastAndSetGeometry();
    this.#initReCreateGeometryTrigger();
  }

  #initReCreateGeometryTrigger() {
    this.reCreateGeometryTrigger$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.geometry().dispose();
        this.geometry.set(this.createGeometry(this.params()));
      });
  }

  #initUpdateGeometry() {
    effect(
      () => {
        if (this.params()) {
          this.updateParameters(this.params());
        }
      },
      { allowSignalWrites: true },
    );
  }

  #iniCastAndSetGeometry() {
    effect(
      () => {
        handleMaterialAndGeometryLinking(this.geometry(), this.parent);
      },
      { allowSignalWrites: true },
    );
  }

  #initSetName() {
    effect(() => {
      const geometry = this.geometry();
      const name = this.name();
      if (name && geometry) {
        geometry.name = name;
      }
    });
  }

  /**
   * Create a new geometry instance with the given parameters when the parameters change.
   */
  createGeometry(parameters: any): BufferGeometry {
    return new BufferGeometry();
  }

  private updateParameters(parameters: any) {
    if (this.previousGeometry) {
      this.previousGeometry.dispose();
    }

    const geometry = this.createGeometry(parameters);
    this.geometry.set(geometry);

    this.previousGeometry = geometry;
  }

  ngOnDestroy(): void {
    this.geometry()?.dispose();
  }
}

type BoxGeometryParameters = ConstructorParameters<typeof BoxGeometry>;

@Component({
  selector: 'boxGeometry',
  template: `<ng-content></ng-content>`,
  providers: [provideBufferGeometryComponent(BoxGeometryComponent)],
  standalone: true,
})
export class BoxGeometryComponent
  extends BufferGeometryComponent
  implements OnDestroy
{
  override readonly params = input<BoxGeometryParameters>([1, 1]);

  override readonly geometry = signal(new BoxGeometry());
  override previousGeometry: BoxGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(parameters: BoxGeometryParameters): BoxGeometry {
    const box = new BoxGeometry(...parameters);

    return box;
  }
}

type SphereGeometryParameters =
  (typeof SphereGeometry)['prototype']['parameters'];

@Component({
  selector: 'sphereGeometry',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideBufferGeometryComponent(SphereGeometryComponent)],
})
export class SphereGeometryComponent
  extends BufferGeometryComponent
  implements OnDestroy
{
  override readonly params = input<Partial<SphereGeometryParameters>>();

  override readonly geometry = signal(new SphereGeometry());
  override previousGeometry: SphereGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(
    parameters: SphereGeometryParameters,
  ): SphereGeometry {
    return new SphereGeometry(
      parameters.radius,
      parameters.widthSegments,
      parameters.heightSegments,
      parameters.phiStart,
      parameters.phiLength,
      parameters.thetaStart,
      parameters.thetaLength,
    );
  }
}

type PlaneGeometryParameters = ConstructorParameters<typeof PlaneGeometry>;
@Component({
  selector: 'planeGeometry',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideBufferGeometryComponent(PlaneGeometryComponent)],
})
export class PlaneGeometryComponent
  extends BufferGeometryComponent
  implements OnDestroy
{
  override readonly params = input<PlaneGeometryParameters>([1, 1]);
  /**
   * Whether to rotate the geometry to be horizontal
   */
  readonly horizontal = input<boolean>(false);

  override readonly geometry = signal(new PlaneGeometry());
  override previousGeometry: PlaneGeometry | undefined = this.geometry();

  constructor() {
    super();
    this.#initHorizontal();
  }

  #initHorizontal() {
    effect(
      () => {
        const horizontal = this.horizontal();
        if (horizontal === undefined) {
          return;
        }
        // Rotate the geometry to be horizontal
        this.geometry().rotateX((Math.PI / 2) * -1);
      },
      { allowSignalWrites: true },
    );
  }

  override createGeometry(parameters: PlaneGeometryParameters): PlaneGeometry {
    return new PlaneGeometry(...parameters);
  }
}

type TorusKnotGeometryParameters = ConstructorParameters<
  typeof TorusKnotGeometry
>;
@Component({
  selector: 'torusKnotGeometry',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideBufferGeometryComponent(TorusKnotGeometryComponent)],
})
export class TorusKnotGeometryComponent
  extends BufferGeometryComponent
  implements OnDestroy
{
  override readonly params = input<TorusKnotGeometryParameters>([
    1, 0.4, 64, 8,
  ]);

  override readonly geometry = signal(new TorusKnotGeometry());
  override previousGeometry: TorusKnotGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(
    parameters: TorusKnotGeometryParameters,
  ): TorusKnotGeometry {
    return new TorusKnotGeometry(...parameters);
  }
}
