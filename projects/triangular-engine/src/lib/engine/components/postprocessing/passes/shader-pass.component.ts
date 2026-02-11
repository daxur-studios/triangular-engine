import { Component, input, signal, untracked } from '@angular/core';
import type { ShaderMaterial } from 'three';
import type { IUniform } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  AbstractPassComponent,
  providePassComponent,
} from './abstract-pass.component';

/**
 * Shader object for custom passes. Matches Three.js ShaderPass constructor shape.
 */
export interface ShaderPassShader {
  uniforms?: { [key: string]: IUniform };
  vertexShader: string;
  fragmentShader: string;
  defines?: { [key: string]: number | string };
}

/**
 * Custom shader pass. Add inside {@link EffectComposerComponent}.
 * Pass a shader object (uniforms, vertexShader, fragmentShader) via the shader input.
 */
@Component({
  standalone: true,
  selector: 'shaderPass',
  template: '',
  providers: [providePassComponent(ShaderPassComponent)],
})
export class ShaderPassComponent extends AbstractPassComponent {
  /** Shader object or ShaderMaterial for the pass. Required to create the pass. */
  readonly shader = input<ShaderPassShader | ShaderMaterial | undefined>();

  readonly textureID = input<string>('tDiffuse');

  override readonly pass = signal<InstanceType<typeof ShaderPass> | undefined>(
    undefined,
  );

  override createPass(): InstanceType<typeof ShaderPass> {
    const pass = untracked(() => this.pass());
    pass?.dispose?.();
    const shader = this.shader();
    if (!shader) {
      throw new Error('shaderPass: shader input is required');
    }
    const instance = new ShaderPass(shader as any, this.textureID());
    this.pass.set(instance);
    return instance;
  }
}
