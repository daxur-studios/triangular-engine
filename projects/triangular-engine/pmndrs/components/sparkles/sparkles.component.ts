import { Component, effect, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Sparkles, SparklesProps } from '@pmndrs/vanilla';
import { Clock, Object3D } from 'three';
import {
  Object3DComponent,
  provideObject3DComponent,
} from 'triangular-engine';

/**
 * Angular wrapper for {@link https://www.npmjs.com/package/@pmndrs/vanilla | @pmndrs/vanilla Sparkles}.
 * GPU particle sparkles; input changes call `rebuildAttributes` on the underlying Points object.
 */
@Component({
  selector: 'sparkles',
  standalone: true,
  imports: [],
  template: ``,
  providers: [provideObject3DComponent(SparklesComponent)],
})
export class SparklesComponent extends Object3DComponent {
  readonly count = input(100);
  readonly speed = input(1);
  readonly opacity = input(1);
  readonly color = input('#ffffff');
  readonly size = input(1);
  /** Maps to @pmndrs/vanilla `scale` (distinct from Object3D `scale`). */
  readonly sparkleScale = input(1);
  readonly noise = input(1);

  private sparkles: Sparkles | undefined;
  private readonly clock = new Clock();

  override object3D = signal<Object3D>(new Object3D());

  constructor() {
    super();
    this.#initSparkles();
    this.#initUpdate();
  }

  #sparklesProps(): SparklesProps {
    return {
      count: this.count(),
      speed: this.speed(),
      opacity: this.opacity(),
      color: this.color(),
      size: this.size(),
      scale: this.sparkleScale(),
      noise: this.noise(),
    };
  }

  #initSparkles() {
    effect(() => {
      const props = this.#sparklesProps();

      if (!this.sparkles) {
        this.sparkles = new Sparkles(props);
        this.object3D.set(this.sparkles);
      } else {
        this.sparkles.rebuildAttributes(props);
      }

      const renderer = this.engineService.renderer;
      if (renderer) {
        this.sparkles.setPixelRatio(renderer.getPixelRatio());
      }
    });
  }

  #initUpdate() {
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.sparkles?.update(this.clock.getElapsedTime());
      });
  }
}
