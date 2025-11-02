import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  output,
} from '@angular/core';
import {
  Camera,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RenderTarget,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TypedArray,
  UnsignedByteType,
  WebGLRenderer,
} from 'three';
import { ISizes } from '../../../models/engine.model';
import { EngineService } from '../../../services/engine.service';

@Component({
  selector: 'renderTarget',
  imports: [],
  templateUrl: './render-target.component.html',
  styleUrl: './render-target.component.css',
  providers: [],
})
export class RenderTargetComponent implements OnDestroy {
  readonly engineService = inject(EngineService);

  /** eg `1024` for 1:1 aspect ratio or `{ width: 1024, height: 2048 }` for rectangular texture */
  readonly size = input.required<number | ISizes>();
  readonly camera = input.required<Camera>();
  /** Whenever this changes, the render target will be rendered again. */
  readonly renderTrigger = input<any>();
  readonly format = input<'Texture' | 'TypedArray'>('Texture');

  /** Emits the baked texture. */
  readonly bakedTexture = output<Texture | TypedArray>();

  currentRenderTarget: RenderTarget | undefined;

  constructor() {
    this.#init();
  }

  ngOnDestroy(): void {
    this.currentRenderTarget?.dispose();
  }

  #init() {
    effect(async () => {
      if (this.currentRenderTarget) {
        this.currentRenderTarget.dispose();
      }

      const size = this.size();
      const renderTrigger = this.renderTrigger();
      if (!renderTrigger) {
        return;
      }

      const renderer = this.engineService.renderer;
      // save current target
      const prevTarget = renderer.getRenderTarget();

      const width = typeof size === 'number' ? size : size.width;
      const height = typeof size === 'number' ? size : size.height;

      // Temporarily disable pixel ratio scaling for exact render target size
      const originalPixelRatio = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false); // don't update style

      // In recent three, use the generic RenderTarget (works for WebGL & WebGPU)
      const rt = new RenderTarget(width, height, {
        // For color textures you'll likely want sRGB for sampling in lit materials:
        colorSpace: SRGBColorSpace, // omit for non-color data like heightmaps
        // For heightmaps you might do:
        type: HalfFloatType,
        format: RGBAFormat,
        // (WebGPU will map to suitable GPU formats)
        //generateMipmaps: true, // if you need mipmaps for distant sampling
        // WebGPU: avoid sampling black by not requiring mipmaps on RT textures
        generateMipmaps: false,
        depthBuffer: true,
      });
      this.currentRenderTarget = rt;

      // 2) Build a fullscreen quad scene that runs your procedural shader once
      const camera = this.camera();

      const scene = this.engineService.scene;

      // 3) Render ONCE to the render target (e.g., after parameters/noise seeds are set)
      if (renderer instanceof WebGLRenderer) {
        // TODO: see if webgl render target works, but for now we only support webgpu
        throw new Error('WebGLRenderer is not supported');
      }

      renderer.setRenderTarget(rt);

      renderer.render(scene, camera);

      // Ensure texture is marked updated after the offscreen render
      rt.texture.needsUpdate = true;

      // 4) Reuse the baked texture anywhere (materials, uniforms, nodes)
      const bakedTex = rt.texture; // keep `rt` alive as long as you need the texture
      bakedTex.name = 'Procedural_Bake_1024';
      //bakedTex.wrapS = bakedTex.wrapT = RepeatWrapping;
      // Do not rely on mipmaps for RT textures on WebGPU
      // bakedTex.minFilter = LinearFilter;
      // bakedTex.magFilter = LinearFilter;
      // bakedTex.generateMipmaps = false;
      // bakedTex.flipY = false;

      // Example usage:
      //const mat = new THREE.MeshStandardMaterial({ map: bakedTex });
      // or in TSL: texture(bakedTex) -> sample in your graph
      const format = this.format();

      if (format === 'TypedArray') {
        const pixels = await renderer.readRenderTargetPixelsAsync(
          rt,
          0,
          0,
          width,
          height,
        );
        this.bakedTexture.emit(pixels);
        // After reading pixels
        // const dataTexture = new DataTexture(pixels, width, height);
        // dataTexture.format = RGBAFormat;
        // dataTexture.type = UnsignedByteType;
        // dataTexture.needsUpdate = true;
      } else {
        this.bakedTexture.emit(bakedTex);
      }

      // Restore original settings
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(originalPixelRatio);

      renderer.setRenderTarget(prevTarget);
    });
  }
}
