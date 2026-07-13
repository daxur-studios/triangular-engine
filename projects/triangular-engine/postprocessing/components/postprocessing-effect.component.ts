import { Directive } from '@angular/core';
import type { Effect } from 'postprocessing';
import type { Camera } from 'three';

/** Base class for effects projected into PostprocessingComposerComponent. */
@Directive({ standalone: true })
export abstract class PostprocessingEffectComponent {
  /** Create the underlying effect for the active engine camera. */
  abstract createEffect(camera: Camera): Effect;
}
