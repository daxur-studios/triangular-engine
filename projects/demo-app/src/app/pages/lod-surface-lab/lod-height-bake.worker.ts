/// <reference lib="webworker" />

import { bakeBuffers, type BakeLayout } from './lod-height-bake';
import { runBake, type BakedSourceId } from './lod-height-noise';
import { parseCellPlanet, type CellPlanetDescription } from './lod-height-terrain';

/**
 * One bake: the source by name (functions do not cross `postMessage`), the texture layout and, for the cell planet, the
 * plain description the worker builds its world from.
 */
export interface BakeRequest {
  readonly id: number;
  readonly source: BakedSourceId;
  readonly layout: BakeLayout;
  readonly planet?: CellPlanetDescription;
}

addEventListener('message', ({ data }: MessageEvent<BakeRequest>) => {
  try {
    const output = runBake(data.source, data.layout, data.planet ? parseCellPlanet(data.planet) : undefined);
    postMessage({ id: data.id, ...output }, bakeBuffers(output.baked));
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
});
