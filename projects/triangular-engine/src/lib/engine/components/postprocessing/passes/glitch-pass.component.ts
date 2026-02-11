import { Component, effect, input, signal, untracked } from '@angular/core';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import {
  AbstractPassComponent,
  providePassComponent,
} from './abstract-pass.component';

/**
 * Glitch effect pass. Add inside {@link EffectComposerComponent}.
 */
@Component({
  standalone: true,
  selector: 'glitchPass',
  template: '',
  providers: [providePassComponent(GlitchPassComponent)],
})
export class GlitchPassComponent extends AbstractPassComponent {
  /** When true, increases the effect intensity noticeably. */
  readonly goWild = input<boolean>(false);

  override readonly pass = signal<InstanceType<typeof GlitchPass> | undefined>(
    undefined,
  );

  constructor() {
    super();
    effect(() => {
      const p = this.pass();
      if (!p) return;
      p.goWild = this.goWild();
    });
  }

  override createPass(): InstanceType<typeof GlitchPass> {
    const pass = untracked(() => this.pass());
    pass?.dispose?.();
    const instance = new GlitchPass(64);
    this.pass.set(instance);
    return instance;
  }
}
