import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
} from '@angular/core';
import { CanvasTexture } from 'three';
import { MaterialComponent } from './material.component';
import { EngineService } from '../../services';

/**
 * Renders an HTML DOM element directly as a canvas texture in WebGL.
 *
 * Value: Enables true HTML-in-Canvas interactive textures mapped onto 3D objects.
 */
@Component({
  selector: 'htmlTexture',
  standalone: true,
  template: '',
})
export class HtmlTextureComponent implements OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly parentMaterial = inject(MaterialComponent);
  private readonly engineService = inject(EngineService);

  /** The DOM element to render as a texture. */
  readonly element = input.required<HTMLElement>();

  private texture?: CanvasTexture;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;

  constructor() {
    this.#initTexture();
  }

  #initTexture() {
    effect((onCleanup) => {
      const el = this.element();
      if (!el) return;

      this.#cleanup();

      const canvas = document.createElement('canvas');
      this.canvas = canvas;

      const rect = el.getBoundingClientRect();
      canvas.width = rect.width || 512;
      canvas.height = rect.height || 512;

      // Enable layoutsubtree on the offscreen 2D canvas
      canvas.setAttribute('layoutsubtree', '');
      canvas.style.position = 'absolute';
      canvas.style.top = '0px';
      canvas.style.left = '0px';
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      canvas.style.pointerEvents = 'none';

      // Create a 1x1 pixel wrapper inside the viewport to force paint records without culling
      let wrapper = document.getElementById('html-texture-offscreen-wrapper');
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'html-texture-offscreen-wrapper';
        wrapper.style.position = 'absolute';
        wrapper.style.top = '0px';
        wrapper.style.left = '0px';
        wrapper.style.width = '1px';
        wrapper.style.height = '1px';
        wrapper.style.overflow = 'hidden';
        wrapper.style.zIndex = '-9999';
        wrapper.style.pointerEvents = 'none';
        document.body.appendChild(wrapper);
      }
      wrapper.appendChild(canvas);

      // Save original styles to restore during cleanup
      const originalWidth = el.style.width;
      const originalHeight = el.style.height;
      const originalBoxSizing = el.style.boxSizing;

      // Force explicit dimensions for the element inside the layout subtree
      el.style.width = `${canvas.width}px`;
      el.style.height = `${canvas.height}px`;
      el.style.boxSizing = 'border-box';

      // Append target element directly to the texture canvas to satisfy drawElementImage requirements
      canvas.appendChild(el);

      const ctx = canvas.getContext('2d');
      this.ctx = ctx;

      const texture = new CanvasTexture(canvas);
      this.texture = texture;

      const mat = this.parentMaterial.material();
      if ('map' in mat) {
        (mat as any).map = texture;
        mat.needsUpdate = true;
      }

      let retries = 0;
      const draw = () => {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Call the native experimental drawElementImage API on the 2D Context
        if (typeof (this.ctx as any).drawElementImage === 'function') {
          try {
            (this.ctx as any).drawElementImage(el, 0, 0);
            this.texture!.needsUpdate = true;
          } catch (e: any) {
            if (e.name === 'InvalidStateError' && retries < 10) {
              retries++;
              requestAnimationFrame(draw);
            } else {
              console.warn('Failed to drawElementImage:', e);
            }
          }
        } else {
          // Render a simple fallback message if the browser flag is disabled
          this.ctx.fillStyle = '#1e1e1e';
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.fillStyle = '#ffffff';
          this.ctx.font = '14px monospace';
          this.ctx.fillText('HTML-in-Canvas disabled.', 10, 30);
          this.ctx.font = '11px monospace';
          this.ctx.fillStyle = '#a0aec0';
          this.ctx.fillText('Enable in Chrome via:', 10, 55);
          this.ctx.fillText('chrome://flags/#canvas-draw-element', 10, 75);
          this.texture!.needsUpdate = true;
        }
      };

      // Perform initial paint
      draw();

      // Listen to the live rendering updates sent by the layout subtree
      el.addEventListener('paint', draw);
      el.addEventListener('input', draw);
      el.addEventListener('scroll', draw);

      onCleanup(() => {
        el.removeEventListener('paint', draw);
        el.removeEventListener('input', draw);
        el.removeEventListener('scroll', draw);
        
        // Restore original styles
        el.style.width = originalWidth;
        el.style.height = originalHeight;
        el.style.boxSizing = originalBoxSizing;

        if (canvas.contains(el)) {
          canvas.removeChild(el);
        }
        if (canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      });
    });
  }

  #cleanup() {
    if (this.texture) {
      this.texture.dispose();
      this.texture = undefined;
    }
    const mat = this.parentMaterial.material();
    if (mat && 'map' in mat) {
      (mat as any).map = null;
      mat.needsUpdate = true;
    }
  }

  ngOnDestroy() {
    this.#cleanup();
  }
}
