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
  CylinderGeometry,
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

type CylinderGeometryParameters = ConstructorParameters<
  typeof CylinderGeometry
>;

@Component({
  selector: 'cylinderGeometry',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [provideBufferGeometryComponent(CylinderGeometryComponent)],
})
export class CylinderGeometryComponent
  extends BufferGeometryComponent
  implements OnDestroy
{
  /**
   * Create a new instance of {@link CylinderGeometry}
   * @param radiusTop Radius of the cylinder at the top. Default `1`
   * @param radiusBottom Radius of the cylinder at the bottom. Default `1`
   * @param height Height of the cylinder. Default `1`
   * @param radialSegments Number of segmented faces around the circumference of the cylinder. Default `32`
   * @param heightSegments Number of rows of faces along the height of the cylinder. Expects a `Integer`. Default `1`
   * @param openEnded A Boolean indicating whether the ends of the cylinder are open or capped. Default `false`, _meaning capped_.
   * @param thetaStart Start angle for first segment. Default `0`, _(three o'clock position)_.
   * @param thetaLength The central angle, often called theta, of the circular sector. Default `Math.PI * 2`, _which makes for a complete cylinder.
   */
  override readonly params = input.required<CylinderGeometryParameters>();

  override readonly geometry = signal(new CylinderGeometry());
  override previousGeometry: CylinderGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(
    parameters: CylinderGeometryParameters,
  ): CylinderGeometry {
    return new CylinderGeometry(...parameters);
  }
}
