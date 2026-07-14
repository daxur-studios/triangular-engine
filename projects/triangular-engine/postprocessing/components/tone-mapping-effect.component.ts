import { Component, input } from '@angular/core';
import {
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
} from 'postprocessing';
import type { Camera } from 'three';
import { PostprocessingEffectComponent } from './postprocessing-effect.component';

/** Declarative wrapper for postprocessing's final tone-mapping effect. */
@Component({
  standalone: true,
  selector: 'toneMappingEffect',
  template: '',
  providers: [
    {
      provide: PostprocessingEffectComponent,
      useExisting: ToneMappingEffectComponent,
    },
  ],
})
export class ToneMappingEffectComponent extends PostprocessingEffectComponent {
  readonly mode = input(ToneMappingMode.AGX);

  override createEffect(_camera: Camera): Effect {
    return new ToneMappingEffect({ mode: this.mode() });
  }
}
