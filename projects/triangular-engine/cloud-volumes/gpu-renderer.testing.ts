import { WebGPURenderer } from 'three/webgpu';

/**
 * Test helper: one shared `WebGPURenderer` forced onto its WebGL2 backend so it runs in headless Chrome.
 * Not shipped; nothing in the public API imports it.
 */
let rendererPromise: Promise<WebGPURenderer> | undefined;

export function getCloudTestRenderer(): Promise<WebGPURenderer> {
  rendererPromise ??= (async () => {
    const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
    await renderer.init();
    return renderer;
  })();
  return rendererPromise;
}
