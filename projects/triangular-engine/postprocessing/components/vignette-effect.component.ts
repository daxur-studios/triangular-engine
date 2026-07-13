import { Component, input } from '@angular/core';
import { VignetteEffect, VignetteTechnique, type Effect } from 'postprocessing';
import type { Camera } from 'three';
import { PostprocessingEffectComponent } from './postprocessing-effect.component';

/** A small built-in effect used to prove and exercise the composer backend. */
@Component({
  standalone: true,
  selector: 'vignetteEffect',
  template: '',
  providers: [
    {
      provide: PostprocessingEffectComponent,
      useExisting: VignetteEffectComponent,
    },
  ],
})
export class VignetteEffectComponent extends PostprocessingEffectComponent {
  readonly offset = input(0.5);
  readonly darkness = input(0.5);
  readonly technique = input(VignetteTechnique.DEFAULT);

  override createEffect(_camera: Camera): Effect {
    return new VignetteEffect({
      offset: this.offset(),
      darkness: this.darkness(),
      technique: this.technique(),
    });
  }
}
