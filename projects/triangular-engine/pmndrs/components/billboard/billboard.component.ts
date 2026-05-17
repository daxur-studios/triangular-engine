import { Component, effect, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Billboard } from '@pmndrs/vanilla';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';

/**
 * Angular wrapper for {@link https://www.npmjs.com/package/@pmndrs/vanilla#billboard | @pmndrs/vanilla Billboard}.
 * Children stay oriented toward the active camera each tick.
 */
@Component({
  selector: 'billboard',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(BillboardComponent)],
})
export class BillboardComponent extends GroupComponent {
  readonly billboard = Billboard({
    follow: true,
    lockX: false,
    lockY: false,
    lockZ: false,
  });

  override object3D = signal(this.billboard.group);

  readonly follow = input(true);
  readonly lockX = input(false);
  readonly lockY = input(false);
  readonly lockZ = input(false);

  constructor() {
    super();
    this.#initProps();
    this.#initUpdate();
  }

  #initProps() {
    effect(() => {
      this.billboard.updateProps({
        follow: this.follow(),
        lockX: this.lockX(),
        lockY: this.lockY(),
        lockZ: this.lockZ(),
      });
    });
  }

  #initUpdate() {
    this.engineService.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const camera = this.engineService.camera$.value;
        if (camera) {
          this.billboard.update(camera);
        }
      });
  }
}
