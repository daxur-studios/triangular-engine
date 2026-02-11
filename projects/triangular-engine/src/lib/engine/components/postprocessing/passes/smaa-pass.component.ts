import { Component, signal, untracked } from '@angular/core';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import {
  AbstractPassComponent,
  providePassComponent,
} from './abstract-pass.component';

/**
 * SMAA (Subpixel Morphological Antialiasing) pass. Use before {@link OutputPassComponent}
 * in the chain. Add inside {@link EffectComposerComponent}.
 */
@Component({
  standalone: true,
  selector: 'smaaPass',
  template: '',
  providers: [providePassComponent(SMAAPassComponent)],
})
export class SMAAPassComponent extends AbstractPassComponent {
  override readonly pass = signal<InstanceType<typeof SMAAPass> | undefined>(
    undefined,
  );

  override createPass(): InstanceType<typeof SMAAPass> {
    const pass = untracked(() => this.pass());
    pass?.dispose?.();
    const instance = new SMAAPass();
    this.pass.set(instance);
    return instance;
  }
}
