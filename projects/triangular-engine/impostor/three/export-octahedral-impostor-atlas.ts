import { WebGLRenderer } from 'three';

import type { IOctahedralImpostorAtlas } from './create-octahedral-impostor-atlas';

const ATLAS_TEXTURE_INDEX: { readonly albedo: 0; readonly normalDepth: 1 } = {
  albedo: 0,
  normalDepth: 1,
};

/**
 * Reads one of a baked atlas's textures back from the GPU and downloads it
 * as a PNG. This is the "pre-create" half of impostor baking: run this once
 * (e.g. from a dev-tool page), ship the PNGs as static assets, and load them
 * directly into `createOctahedralImpostorMaterial` at runtime instead of
 * calling `createOctahedralImpostorAtlas` on every load. Port of the
 * reference octahedral-impostor library's `exportTextureFromRenderTarget`.
 */
export function exportOctahedralImpostorAtlas(
  renderer: WebGLRenderer,
  atlas: IOctahedralImpostorAtlas,
  which: 'albedo' | 'normalDepth',
  fileName: string,
): void {
  const image = atlas.renderTarget.texture.image as { width: number; height: number };
  const width = image.width;
  const height = image.height;
  const readBuffer = new Uint8Array(width * height * 4);

  renderer.readRenderTargetPixels(
    atlas.renderTarget,
    0,
    0,
    width,
    height,
    readBuffer,
    undefined,
    ATLAS_TEXTURE_INDEX[which],
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('exportOctahedralImpostorAtlas: 2D canvas context unavailable.');

  const imageData = context.createImageData(width, height);
  const pixels = imageData.data;

  // WebGL readback is bottom-left origin; ImageData is top-left. Flip rows
  // so the exported PNG isn't upside down relative to what was baked.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dest = (x + y * width) * 4;
      const src = (x + (height - y - 1) * width) * 4;
      pixels[dest] = readBuffer[src];
      pixels[dest + 1] = readBuffer[src + 1];
      pixels[dest + 2] = readBuffer[src + 2];
      pixels[dest + 3] = readBuffer[src + 3];
    }
  }

  context.putImageData(imageData, 0, 0);

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${fileName}.png`;
  link.click();
}
