import { inject, Injectable } from '@angular/core';
import { Camera, OrthographicCamera, PerspectiveCamera } from 'three';
import { EngineService } from './engine.service';

/** Configuration options for capturing screenshots. */
export interface ScreenshotOptions {
  /** Output image MIME type. Defaults to `'image/png'`. */
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Image compression quality (0.0 to 1.0) for `'image/jpeg'` and `'image/webp'`. Defaults to 0.92. */
  quality?: number;
  /** Resolution scale multiplier relative to current engine size (e.g. 1 = native, 2 = 2x, 4 = 4x). Defaults to 1. */
  multiplier?: number;
  /** Exact target resolution in pixels. When specified, overrides `multiplier`. */
  resolution?: { width: number; height: number };
  /** Number of progressive sub-pixel SSAA accumulation samples (1 = instant single pass, 8..32 = smooth anti-aliasing). Defaults to 1. */
  samples?: number;
  /** Automatically hide CSS2D and CSS3D DOM overlay markers/HUD during capture. Defaults to `true`. */
  hideOverlays?: boolean;
  /** Default filename when downloading. Defaults to `'screenshot-<timestamp>.<ext>'`. */
  fileName?: string;
  /** Optional progress callback receiving normalized completion (0.0 to 1.0) during multi-sample capture. */
  onProgress?: (progress: number) => void;
  /**
   * Optional lifecycle hook executed before capture starts.
   * Can return an optional cleanup/restore callback that will be called after capture completes.
   */
  prepare?: () => Promise<(() => void) | void> | (() => void) | void;
}

/**
 * Service for capturing high-quality screenshots and progressive anti-aliased renderings.
 *
 * Supports instant frame snapshots, offscreen resolution scaling, progressive sub-pixel
 * jitter accumulation (SSAA), DOM overlay hiding, and custom quality preparation hooks.
 */
@Injectable({
  providedIn: 'root',
})
export class ScreenshotService {
  private readonly injectedEngine = inject(EngineService, { optional: true });

  /** Returns the active EngineService instance. */
  get engine(): EngineService | undefined {
    return this.injectedEngine ?? EngineService.activeInstance;
  }

  /**
   * Captures a screenshot based on the provided configuration options.
   *
   * @param options Capture options including resolution multiplier, samples, format, and hooks.
   * @returns A promise resolving to the image `Blob`.
   */
  public async capture(options: ScreenshotOptions = {}): Promise<Blob> {
    const engine = this.engine;
    if (!engine) {
      throw new Error('[ScreenshotService] No active EngineService instance found.');
    }

    const {
      format = 'image/png',
      quality = 0.92,
      multiplier = 1,
      resolution,
      samples = 1,
      hideOverlays = true,
      onProgress,
      prepare,
    } = options;

    let cleanupPrepare: (() => void) | undefined = undefined;
    let restoreOverlays: (() => void) | undefined = undefined;
    const prevSpeedFactor = engine.speedFactor$.value;

    try {
      // 1. Run user-defined preparation hook (e.g. elevate LODs, shadow resolution)
      if (prepare) {
        cleanupPrepare = (await prepare()) ?? undefined;
      }

      // 2. Hide CSS2D / CSS3D DOM overlays if requested
      if (hideOverlays) {
        restoreOverlays = this.toggleOverlays(engine, true);
      }

      const baseWidth = engine.width;
      const baseHeight = engine.height;
      const targetWidth = Math.max(1, Math.round(resolution ? resolution.width : baseWidth * multiplier));
      const targetHeight = Math.max(1, Math.round(resolution ? resolution.height : baseHeight * multiplier));

      // 3. Fast path: native resolution, single sample
      if (samples <= 1 && multiplier === 1 && !resolution) {
        engine.render(engine.fpsController.lastRenderTime, true);
        onProgress?.(1);
        return await this.canvasToBlob(engine.canvas, format, quality);
      }

      // 4. Progressive / Scaled capture path: pause simulation clock to prevent movement during capture
      engine.setSpeedFactor(0);

      const blob = await this.renderProgressive({
        engine,
        targetWidth,
        targetHeight,
        samples: Math.max(1, samples),
        format,
        quality,
        onProgress,
      });

      return blob;
    } finally {
      // Restore simulation speed
      engine.setSpeedFactor(prevSpeedFactor);

      // Restore DOM overlays
      if (restoreOverlays) {
        restoreOverlays();
      }

      // Run cleanup from prepare hook
      if (cleanupPrepare) {
        try {
          cleanupPrepare();
        } catch (err) {
          console.error('[ScreenshotService] Error in prepare cleanup hook:', err);
        }
      }
    }
  }

  /**
   * Captures a screenshot and immediately triggers a browser file download.
   *
   * @param options Capture options.
   * @returns A promise resolving to the captured `Blob`.
   */
  public async captureAndDownload(options: ScreenshotOptions = {}): Promise<Blob> {
    const blob = await this.capture(options);
    this.download(blob, options.fileName);
    return blob;
  }

  /**
   * Triggers a browser download for an image Blob.
   *
   * @param blob The image blob to download.
   * @param fileName Optional file name with extension.
   */
  public download(blob: Blob, fileName?: string): void {
    const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const name = fileName ?? `screenshot-${Date.now()}.${ext}`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Copies the image blob to the user's system clipboard.
   *
   * @param blob The image blob to copy.
   */
  public async copyToClipboard(blob: Blob): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
    } else {
      throw new Error('[ScreenshotService] Clipboard API is not supported in this browser environment.');
    }
  }

  /** Renders multiple sub-pixel jittered passes and accumulates them onto an offscreen canvas. */
  private async renderProgressive(params: {
    engine: EngineService;
    targetWidth: number;
    targetHeight: number;
    samples: number;
    format: string;
    quality: number;
    onProgress?: (progress: number) => void;
  }): Promise<Blob> {
    const { engine, targetWidth, targetHeight, samples, format, quality, onProgress } = params;

    const renderer = engine.renderer;
    const camera = engine.camera;

    const origWidth = engine.width;
    const origHeight = engine.height;
    const origPixelRatio = engine.pixelRatio;

    // Create accumulator 2D canvas
    const accumulatorCanvas = document.createElement('canvas');
    accumulatorCanvas.width = targetWidth;
    accumulatorCanvas.height = targetHeight;
    const ctx = accumulatorCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('[ScreenshotService] Failed to acquire 2D context for offscreen accumulation.');
    }

    // Set renderer to target capture resolution
    renderer.setPixelRatio(1);
    renderer.setSize(targetWidth, targetHeight, false);
    engine.renderPipeline?.setSize(targetWidth, targetHeight, 1);
    this.updateCameraAspect(camera, targetWidth, targetHeight);

    try {
      for (let i = 0; i < samples; i++) {
        // Sub-pixel jitter using low-discrepancy Halton sequence
        if (samples > 1) {
          const jitterX = this.halton(i + 1, 2) - 0.5;
          const jitterY = this.halton(i + 1, 3) - 0.5;
          this.setCameraJitter(camera, targetWidth, targetHeight, jitterX, jitterY);
        }

        // Render current sample frame
        engine.render(engine.fpsController.lastRenderTime, true);

        // Blend sample into accumulator canvas with running average weight: alpha = 1 / (i + 1)
        ctx.globalAlpha = 1 / (i + 1);
        ctx.drawImage(engine.canvas, 0, 0, targetWidth, targetHeight);

        onProgress?.((i + 1) / samples);

        // Yield to browser execution to maintain responsiveness and permit UI progress bar updates
        if (samples > 1 && i < samples - 1) {
          await this.yieldNextFrame();
        }
      }
    } finally {
      // Clear camera jitter offset
      this.clearCameraJitter(camera);

      // Restore original renderer and camera dimensions
      renderer.setPixelRatio(origPixelRatio);
      renderer.setSize(origWidth, origHeight, true);
      engine.renderPipeline?.setSize(origWidth, origHeight, origPixelRatio);
      this.updateCameraAspect(camera, origWidth, origHeight);
      engine.render(engine.fpsController.lastRenderTime, true);
    }

    return await this.canvasToBlob(accumulatorCanvas, format, quality);
  }

  /** Applies a sub-pixel jitter offset to the camera projection. */
  private setCameraJitter(
    camera: Camera,
    fullWidth: number,
    fullHeight: number,
    jitterX: number,
    jitterY: number,
  ): void {
    if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
      camera.setViewOffset(fullWidth, fullHeight, jitterX, jitterY, fullWidth, fullHeight);
    }
  }

  /** Clears the camera view offset. */
  private clearCameraJitter(camera: Camera): void {
    if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
      camera.clearViewOffset();
    }
  }

  /** Updates camera aspect ratio / projection for a target dimension. */
  private updateCameraAspect(camera: Camera, width: number, height: number): void {
    if (camera instanceof PerspectiveCamera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    } else if (camera instanceof OrthographicCamera) {
      const aspect = width / height;
      const viewHeight = camera.top - camera.bottom;
      camera.left = -((aspect * viewHeight) / 2);
      camera.right = (aspect * viewHeight) / 2;
      camera.updateProjectionMatrix();
    }
  }

  /** Temporarily toggles visibility of CSS2D and CSS3D overlay containers. */
  private toggleOverlays(engine: EngineService, hide: boolean): () => void {
    const css2d = engine.CSS2DRenderer?.domElement;
    const css3d = engine.CSS3DRenderer?.domElement;

    const prev2d = css2d?.style.display;
    const prev3d = css3d?.style.display;

    if (hide) {
      if (css2d) css2d.style.display = 'none';
      if (css3d) css3d.style.display = 'none';
    }

    return () => {
      if (css2d && prev2d !== undefined) css2d.style.display = prev2d;
      if (css3d && prev3d !== undefined) css3d.style.display = prev3d;
    };
  }

  /** Converts an HTMLCanvasElement to a Blob asynchronously. */
  private canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('[ScreenshotService] Failed to export canvas to Blob.'));
          }
        },
        format,
        quality,
      );
    });
  }

  /** Halton low-discrepancy sequence for 2D sub-pixel jitter offsets. */
  private halton(index: number, base: number): number {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  }

  /** Yields execution to the next animation frame or tick. */
  private yieldNextFrame(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}
