import {
  Component,
  contentChildren,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
} from 'postprocessing';
import { HalfFloatType, WebGLRenderer } from 'three';
import type { Camera, TextureDataType } from 'three';
import {
  EngineService,
  type EngineRenderPipeline,
} from 'triangular-engine';
import { PostprocessingEffectComponent } from './postprocessing-effect.component';

/** Declarative wrapper around pmndrs/postprocessing's EffectComposer. */
@Component({
  standalone: true,
  selector: 'postprocessing-composer',
  template: '<ng-content />',
})
export class PostprocessingComposerComponent implements OnInit, OnDestroy {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = input(true);
  readonly enableNormalPass = input(false);
  readonly frameBufferType = input<TextureDataType>(HalfFloatType);
  readonly effectComponents = contentChildren(PostprocessingEffectComponent, {
    descendants: true,
  });

  private composer: EffectComposer | undefined;
  private renderPass: RenderPass | undefined;
  private normalPass: NormalPass | undefined;
  private effectPass: EffectPass | undefined;
  private pipeline: EngineRenderPipeline | undefined;
  private camera: Camera | undefined;

  constructor() {
    effect(() => {
      const children = this.effectComponents();
      const withNormals = this.enableNormalPass();
      if (this.composer && this.camera) {
        this.rebuildPasses(children, withNormals, this.camera);
      }
    });
  }

  ngOnInit(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) {
      throw new Error(
        'PostprocessingComposerComponent requires THREE.WebGLRenderer.',
      );
    }
    if (!renderer.capabilities.isWebGL2) {
      throw new Error(
        'PostprocessingComposerComponent requires WebGL2-class functionality.',
      );
    }

    this.camera = this.engine.camera;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: this.frameBufferType(),
    });
    this.rebuildPasses(
      this.effectComponents(),
      this.enableNormalPass(),
      this.camera,
    );

    const composer = this.composer;
    this.pipeline = {
      render: (deltaTime) => {
        if (this.enabled()) {
          composer.setMainCamera(this.engine.camera);
          composer.render(deltaTime);
        } else {
          renderer.render(this.engine.scene, this.engine.camera);
        }
      },
      setSize: (width, height, _pixelRatio) => {
        composer.setSize(width, height);
      },
    };
    this.engine.registerRenderPipeline(this.pipeline);

    this.engine.camera$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((camera) => {
        if (camera === this.camera || !this.composer) return;
        this.camera = camera;
        this.rebuildPasses(
          this.effectComponents(),
          this.enableNormalPass(),
          camera,
        );
      });
  }

  ngOnDestroy(): void {
    if (this.pipeline) {
      this.engine.unregisterRenderPipeline(this.pipeline);
      this.pipeline = undefined;
    }
    this.disposePasses();
    this.composer?.dispose();
    this.composer = undefined;
  }

  private rebuildPasses(
    children: readonly PostprocessingEffectComponent[],
    withNormals: boolean,
    camera: Camera,
  ): void {
    const composer = this.composer;
    if (!composer) return;

    this.disposePasses();
    this.renderPass = new RenderPass(this.engine.scene, camera);
    composer.addPass(this.renderPass);

    if (withNormals) {
      this.normalPass = new NormalPass(this.engine.scene, camera);
      composer.addPass(this.normalPass);
    }

    const normalBuffer = this.normalPass?.texture ?? null;
    const effects = children.map((child) => {
      const created = child.createEffect(camera);
      child.setNormalBuffer(normalBuffer);
      return created;
    });
    if (effects.length > 0) {
      this.effectPass = new EffectPass(camera, ...effects);
      const renderer = this.engine.renderer as WebGLRenderer;
      if (renderer.capabilities?.logarithmicDepthBuffer) {
        const material = this.effectPass.fullscreenMaterial as any;
        if (material) {
          material.logarithmicDepthBuffer = true;
        }
      }
      composer.addPass(this.effectPass);
    }
  }

  private disposePasses(): void {
    const composer = this.composer;
    for (const pass of [this.effectPass, this.normalPass, this.renderPass]) {
      if (pass) {
        composer?.removePass(pass);
        pass.dispose();
      }
    }
    this.effectPass = undefined;
    this.normalPass = undefined;
    this.renderPass = undefined;
  }
}
