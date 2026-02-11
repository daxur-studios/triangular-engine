import {
  Component,
  contentChildren,
  DestroyRef,
  effect,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { EngineService } from '../../../services';
import { AbstractPassComponent } from '../passes/abstract-pass.component';

/**
 * Declarative wrapper for Three.js EffectComposer. Place inside `<scene>` and add pass
 * components as content. When present, the engine uses the composer for rendering instead
 * of direct renderer.render(). Only works with WebGL renderer; ignored when using WebGPU.
 *
 * @example
 * ```html
 * <scene>
 *   <mesh>...</mesh>
 *   <effect-composer>
 *     <unrealBloomPass [strength]="1.5" [radius]="0.4" [threshold]="0.85" />
 *     <glitchPass />
 *     <outputPass />
 *   </effect-composer>
 * </scene>
 * ```
 */
@Component({
  standalone: true,
  selector: 'effect-composer',
  template: '<ng-content />',
})
export class EffectComposerComponent implements OnInit, OnDestroy {
  private readonly engineService = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly passComponents = contentChildren(AbstractPassComponent);

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private addedPasses: Pass[] = [];

  constructor() {
    effect(() => {
      const children = this.passComponents();
      if (!this.composer) return;

      // Remove previously added child passes (keep RenderPass at index 0)
      for (const p of this.addedPasses) {
        this.composer.removePass(p);
      }
      this.addedPasses = [];

      for (const child of children) {
        const pass = child.createPass();
        this.composer.addPass(pass);
        this.addedPasses.push(pass);
      }
    });
  }

  ngOnInit(): void {
    const { renderer, scene, camera } = this.engineService;
    if (!(renderer instanceof WebGLRenderer)) {
      return;
    }

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.engineService.setComposer(this.composer, this.renderPass);

    // Keep RenderPass camera in sync when camera is switched
    this.engineService.camera$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cam) => {
        if (this.renderPass) {
          this.renderPass.camera = cam;
        }
      });
  }

  ngOnDestroy(): void {
    for (const p of this.addedPasses) {
      if (this.composer) {
        this.composer.removePass(p);
      }
    }
    this.addedPasses = [];
    this.renderPass?.dispose();
    this.renderPass = null;
    this.engineService.clearComposer();
    this.composer = null;
  }
}
