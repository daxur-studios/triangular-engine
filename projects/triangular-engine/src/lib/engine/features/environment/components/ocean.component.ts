import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  input,
  effect,
} from '@angular/core';
import { PlaneGeometry, MeshLambertMaterial, Vector3, MathUtils } from 'three';
import { MeshComponent } from '../../../components/mesh/mesh.component';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../../../components/object-3d/object-3d.component';
import { EngineService } from '../../../services';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface VertexData {
  initH: number;
  amplitude: number;
  phase: number;
}

@Component({
  selector: 'ocean',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(OceanComponent)],
})
export class OceanComponent extends MeshComponent implements OnInit, OnDestroy {
  private vertexData: VertexData[] = [];
  private planeGeometry!: PlaneGeometry;
  override readonly engineService = inject(EngineService);

  // Size input parameters
  readonly width = input<number>(50);
  readonly height = input<number>(50);
  readonly segmentsWidth = input<number>(15);
  readonly segmentsHeight = input<number>(15);

  constructor() {
    super();

    // Watch for size changes and recreate geometry
    effect(
      () => {
        this.createGeometry();
      },
      { allowSignalWrites: true },
    );
  }

  override ngOnInit(): void {
    super.ngOnInit();

    // Create aqua-colored Lambert material
    const material = new MeshLambertMaterial({
      color: 'aqua',
    });

    // Set material using the model signal
    this.material.set(material);

    // Subscribe to animation loop
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => {
        this.animateWaves(delta);
      });
  }

  private createGeometry(): void {
    // Create plane geometry rotated to be horizontal
    this.planeGeometry = new PlaneGeometry(
      this.width(),
      this.height(),
      this.segmentsWidth(),
      this.segmentsHeight(),
    );
    this.planeGeometry.rotateX(-Math.PI * 0.5);

    // Store vertex data for wave animation
    this.vertexData = [];
    const v3 = new Vector3();
    for (let i = 0; i < this.planeGeometry.attributes['position'].count; i++) {
      v3.fromBufferAttribute(this.planeGeometry.attributes['position'], i);
      this.vertexData.push({
        initH: v3.y,
        amplitude: MathUtils.randFloatSpread(2),
        phase: MathUtils.randFloat(0, Math.PI),
      });
    }

    // Set geometry using the model signal
    this.geometry.set(this.planeGeometry);
  }

  private animateWaves(delta: number): void {
    if (!this.planeGeometry) {
      return;
    }
    const time = this.engineService.clock.getElapsedTime();

    this.vertexData.forEach((vd, idx) => {
      const y = vd.initH + Math.sin(time + vd.phase) * vd.amplitude;
      this.planeGeometry.attributes['position'].setY(idx, y);
    });

    this.planeGeometry.attributes['position'].needsUpdate = true;
    this.planeGeometry.computeVertexNormals();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
  }
}
