import {
  Component,
  Injector,
  OnInit,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Mesh,
  Vector3,
  MathUtils,
  Uniform,
} from 'three';
import {
  MeshComponent,
  Object3DComponent,
  provideObject3DComponent,
} from '../../../components';
import { SkyBoxMaterialComponent } from '../materials';
import { EngineService } from '../../../services';

@Component({
  selector: 'skyBox',
  standalone: true,
  template: `
    <skyBoxMaterial />
    <ng-content></ng-content>
  `,
  imports: [SkyBoxMaterialComponent],
  providers: [provideObject3DComponent(SkyBoxComponent)],
})
export class SkyBoxComponent extends MeshComponent implements OnInit {
  override readonly engineService = inject(EngineService);

  // Configuration signals
  readonly halfSize = signal(2000);
  readonly speed = signal(0.05);
  readonly angle = signal(-1);

  // Vectors and matrices
  private readonly initial = new Vector3(0, 1, 0);
  private readonly axis = new Vector3(0, 0, 1).applyAxisAngle(
    new Vector3(0, 1, 0),
    MathUtils.degToRad(-30),
  );
  readonly dirToLight = signal(new Vector3());
  readonly rotationMatrix = signal(new Uniform(new Matrix3()));

  constructor() {
    super();
    this.setupGeometry();
    this.setupRotation();
  }

  private setupGeometry() {
    const size = this.halfSize();
    const vertices = new Float32Array([
      -size,
      -size,
      -size,
      size,
      -size,
      -size,
      -size,
      -size,
      size,
      size,
      -size,
      size,
      -size,
      size,
      -size,
      size,
      size,
      -size,
      -size,
      size,
      size,
      size,
      size,
      size,
    ]);

    const indices = [
      2, 3, 0, 3, 1, 0, 0, 1, 4, 1, 5, 4, 1, 3, 5, 3, 7, 5, 3, 2, 7, 2, 6, 7, 2,
      0, 6, 0, 4, 6, 4, 5, 6, 5, 7, 6,
    ];

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(vertices, 3));
    geometry.setAttribute('coord', new BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    this.object3D().geometry = geometry;
  }

  private setSkyRotationMatrix(angle: number) {
    const cos = Math.cos(angle);
    const cos1 = 1 - cos;
    const sin = Math.sin(angle);
    const u = this.axis;
    const u2 = this.axis.clone().multiply(this.axis);

    this.rotationMatrix().value.set(
      cos + u2.x * cos1,
      u.x * u.y * cos1 - u.z * sin,
      u.x * u.z * cos1 + u.y * sin,
      u.y * u.x * cos1 + u.z * sin,
      cos + u2.y * cos1,
      u.y * u.z * cos1 - u.x * sin,
      u.z * u.x * cos1 - u.y * sin,
      u.z * u.y * cos1 + u.x * sin,
      cos + u2.z * cos1,
    );
  }

  private setupRotation() {
    effect(
      () => {
        if (!this.engineService.camera) return;

        // Update rotation
        const currentAngle = this.angle();
        this.setSkyRotationMatrix(currentAngle);
        this.initial.applyMatrix3(this.rotationMatrix().value);
        this.dirToLight.update((light) =>
          light.set(-this.initial.x, this.initial.y, -this.initial.z),
        );
        this.initial.set(0, 1, 0);

        // Update position to follow camera
        this.object3D().position.copy(this.engineService.camera.position);
      },
      { injector: this.injector, allowSignalWrites: true },
    );
  }

  override ngOnInit() {
    super.ngOnInit();

    // Initialize light direction
    this.dirToLight.update((light) => light.copy(this.initial));
    this.setSkyRotationMatrix(this.angle());
    this.initial.applyMatrix3(this.rotationMatrix().value);
    this.dirToLight.update((light) =>
      light.set(-this.initial.x, this.initial.y, -this.initial.z),
    );
    this.initial.set(0, 1, 0);
  }
}
