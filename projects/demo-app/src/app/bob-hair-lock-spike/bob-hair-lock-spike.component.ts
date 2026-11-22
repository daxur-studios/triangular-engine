import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { Color } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { EngineModule, EngineService } from 'triangular-engine';
import { createBobHairLockSpikeScene } from './core';

/** Tests whether a TSL sweep can shape the hem of one bob lock in place. */
@Component({
  selector: 'app-bob-hair-lock-spike',
  imports: [EngineModule],
  templateUrl: './bob-hair-lock-spike.component.html',
  styleUrl: './bob-hair-lock-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true, preferredRenderer: 'webgpu' })],
  host: { class: 'flex-page' },
})
export class BobHairLockSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly length = signal(100);
  readonly flare = signal(70);
  readonly angle = signal(35);
  readonly backend = signal('Starting renderer');

  private readonly scene = createBobHairLockSpikeScene(this.engine);

  constructor() {
    this.engine.scene.background = new Color('#242327');
    this.scene.setAngle(this.angle());
    this.scene.setFlare(this.flare());
    this.destroyRef.onDestroy(() => this.scene.dispose());

    this.engine.renderComplete$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const renderer = this.engine.renderer;
      const native = renderer instanceof WebGPURenderer &&
        'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend === true;
      this.backend.set(native ? 'Native WebGPU' : 'WebGL fallback');
    });
  }

  setLength(input: HTMLInputElement): void {
    this.length.set(input.valueAsNumber);
    this.scene.setLength(this.length());
  }

  setFlare(input: HTMLInputElement): void {
    this.flare.set(input.valueAsNumber);
    this.scene.setFlare(this.flare());
  }

  setAngle(input: HTMLInputElement): void {
    this.angle.set(input.valueAsNumber);
    this.scene.setAngle(this.angle());
  }
}
