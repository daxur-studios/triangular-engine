import { HalfFloatType, RenderTarget } from 'three';
import type { EngineService } from 'triangular-engine';

/**
 * Debug helper for automated checks: renders one frame into a render target, reads it back and shows
 * it as a DOM `<img>` overlay. A hidden browser pane never presents canvas frames (requestAnimationFrame
 * is stopped), so a screenshot of the canvas is stale, while a DOM overlay is composited normally.
 * Linear -> sRGB is a plain gamma, so it is for eyeballing only. Opt in with `?debug=1` on a page.
 */
export async function snapshotToOverlay(
  engine: EngineService,
  width = 960,
  height = 540,
): Promise<void> {
  const renderer = engine.renderer as unknown as {
    setRenderTarget(target: RenderTarget | null): void;
    render(scene: unknown, camera: unknown): void;
    readRenderTargetPixelsAsync(
      target: RenderTarget,
      x: number,
      y: number,
      w: number,
      h: number,
    ): Promise<Uint16Array | Float32Array>;
  };
  const target = new RenderTarget(width, height, { type: HalfFloatType, depthBuffer: true });
  engine.tick(performance.now());
  renderer.setRenderTarget(target);
  renderer.render(engine.scene, engine.camera);
  renderer.setRenderTarget(null);
  const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  target.dispose();

  const half = (h: number): number => {
    const e = (h >> 10) & 31;
    const m = h & 1023;
    const sign = h & 0x8000 ? -1 : 1;
    return e === 0 ? sign * 2 ** -14 * (m / 1024) : sign * 2 ** (e - 15) * (1 + m / 1024);
  };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((height - 1 - y) * width + x) * 4;
      const dst = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const v = data instanceof Uint16Array ? half(data[src + k]) : data[src + k];
        image.data[dst + k] = 255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
      }
      image.data[dst + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  let img = document.getElementById('snapshot-overlay') as HTMLImageElement | null;
  if (!img) {
    img = document.createElement('img');
    img.id = 'snapshot-overlay';
    img.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:9999;pointer-events:none`;
    document.body.appendChild(img);
  }
  img.src = canvas.toDataURL('image/png');
  await new Promise((resolve) => setTimeout(resolve, 300));
}
