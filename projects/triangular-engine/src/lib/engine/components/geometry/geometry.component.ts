import {
  Component,
  InputSignal,
  OnDestroy,
  Provider,
  WritableSignal,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  BoxGeometry,
  BufferGeometry,
  PlaneGeometry,
  SphereGeometry,
} from 'three';

import { MeshComponent } from '../mesh/mesh.component';
import { PointsComponent } from '../particle';
import { Object3DComponent } from '../object-3d';
import { InstancedMeshComponent } from '../mesh';
import { InstancedRigidBodyComponent } from '../physics';
import { LineComponent } from '../curve/line.component';
import { handleMaterialAndGeometryLinking } from '../util';

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
  //#endregion

  readonly params = input<any>();

  readonly name = input<string>();

  readonly geometry: WritableSignal<BufferGeometry> = signal(
    new BufferGeometry(),
  );
  previousGeometry: BufferGeometry | undefined;

  emoji = '🌐';

  constructor() {
    this.#initUpdateGeometry();
    this.#initSetName();
    this.#iniCastAndSetGeometry();
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
        // const geometry = this.geometry();
        // // Cast to MeshComponent to see if it should be added to the mesh
        // if (this.parent instanceof MeshComponent) {
        //   this.parent.geometry.set(geometry);
        //   this.parent.mesh().geometry = geometry;
        // }
        // // Cast to PointsComponent to see if it should be added to the points
        // else if (this.parent instanceof PointsComponent) {
        //   this.parent.geometry.set(geometry);
        //   this.parent.points().geometry = geometry;
        // } else if (this.parent instanceof InstancedMeshComponent) {
        //   this.parent.geometry.set(geometry);
        //   this.parent.instancedMesh().geometry = geometry;
        // } else if (this.parent instanceof InstancedRigidBodyComponent) {
        //   this.parent.geometry.set(geometry);
        // } else if (this.parent instanceof LineComponent) {
        //   this.parent.geometry.set(geometry);
        // }
        // TO DO, MAKE THIS EASIER, MORE SAFE TO MAINTAIN
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
  selector: 'box-geometry',
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
  selector: 'plane-geometry',
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

  override readonly geometry = signal(new PlaneGeometry());
  override previousGeometry: PlaneGeometry | undefined = this.geometry();

  constructor() {
    super();
  }

  override createGeometry(parameters: PlaneGeometryParameters): PlaneGeometry {
    return new PlaneGeometry(...parameters);
  }
}
