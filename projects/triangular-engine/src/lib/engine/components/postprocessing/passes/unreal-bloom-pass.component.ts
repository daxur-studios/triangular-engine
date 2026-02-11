import { Component, effect, input, signal, untracked } from '@angular/core';
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  AbstractPassComponent,
  providePassComponent,
} from './abstract-pass.component';

/**
 * Unreal Engine-style bloom pass. Add inside {@link EffectComposerComponent}.
 * Tone mapping should be enabled on the renderer.
 */
@Component({
  standalone: true,
  selector: 'unrealBloomPass',
  template: '',
  providers: [providePassComponent(UnrealBloomPassComponent)],
})
export class UnrealBloomPassComponent extends AbstractPassComponent {
  readonly strength = input<number>(1);
  readonly radius = input<number>(0.4);
  readonly threshold = input<number>(0.85);

  override readonly pass = signal<InstanceType<typeof UnrealBloomPass> | undefined>(
    undefined,
  );

  constructor() {
    super();
    effect(() => {
      const p = this.pass();
      if (!p) return;
      p.strength = this.strength();
      p.radius = this.radius();
      p.threshold = this.threshold();
    });
  }

  override createPass(): InstanceType<typeof UnrealBloomPass> {
    const pass = untracked(() => this.pass());
    pass?.dispose?.();
    const resolution = new Vector2(256, 256);
    const instance = new UnrealBloomPass(
      resolution,
      this.strength(),
      this.radius(),
      this.threshold(),
    );
    this.pass.set(instance);
    return instance;
  }
}
