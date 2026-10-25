/// <reference lib="webworker" />

import { bakeBuffers, bakeHeights, type BakeLayout } from './lod-height-bake';
import { samplerFor, type BakedSourceId } from './lod-height-noise';

/** One bake: the source by name (functions do not cross `postMessage`) and the texture layout. */
export interface BakeRequest {
  readonly id: number;
  readonly source: BakedSourceId;
  readonly layout: BakeLayout;
}

addEventListener('message', ({ data }: MessageEvent<BakeRequest>) => {
  try {
    const baked = bakeHeights(data.layout, samplerFor(data.source, data.layout));
    postMessage({ id: data.id, baked }, bakeBuffers(baked));
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
});
