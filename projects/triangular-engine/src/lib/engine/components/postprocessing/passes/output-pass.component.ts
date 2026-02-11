import { Component, signal, untracked } from '@angular/core';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  AbstractPassComponent,
  providePassComponent,
} from './abstract-pass.component';

/**
 * Output pass for tone mapping and color space conversion. Should typically
 * be the last pass in the chain. Add inside {@link EffectComposerComponent}.
 */
@Component({
  standalone: true,
  selector: 'outputPass',
  template: '',
  providers: [providePassComponent(OutputPassComponent)],
})
export class OutputPassComponent extends AbstractPassComponent {
  override readonly pass = signal<InstanceType<typeof OutputPass> | undefined>(
    undefined,
  );

  override createPass(): InstanceType<typeof OutputPass> {
    const pass = untracked(() => this.pass());
    pass?.dispose?.();
    const instance = new OutputPass();
    this.pass.set(instance);
    return instance;
  }
}
