import {
  Component,
  effect,
  input,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BufferGeometry, Material, Points } from 'three';
import { Object3DComponent, provideObject3DComponent } from '../object-3d';
import { IParticle } from './particle.model';

// particles: Particle[] = [];
// geometry: THREE.BufferGeometry;
// material: THREE.PointsMaterial;
// points: THREE.Points;
// maxParticles: number;
// positions: Float32Array;

@Component({
    selector: 'particleSystem',
    imports: [],
    template: `<ng-content></ng-content>`,
    providers: [provideObject3DComponent(ParticleSystemComponent)]
})
export class ParticleSystemComponent extends Object3DComponent {
  //#region Injected Dependencies
  //#endregion

  readonly points = signal(new Points());
  get object3D() {
    return this.points;
  }

  readonly maxParticles = input.required<number>();
  readonly particles = input.required<IParticle[]>();

  readonly geometry = signal<BufferGeometry | undefined>(undefined);
  readonly material = signal<Material | undefined>(undefined);

  constructor() {
    super();

    this.initParticleUpdate();

    this.#initSetGeometry();
    this.#initSetMaterial();
  }

  protected initParticleUpdate() {
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((delta) => {
        this.updateParticles(delta);
      });
  }

  protected updateParticles(delta: number) {
    // const particles = this.particles();
  }

  #initSetGeometry() {
    effect(() => {
      const geometry = this.geometry();
      const points = this.points();
      if (geometry) {
        points.geometry = geometry;
      }
    });
  }

  #initSetMaterial() {
    effect(() => {
      const material = this.material();
      const points = this.points();
      if (material) {
        points.material = material;
      }
    });
  }
}
