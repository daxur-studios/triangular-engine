import type { BakeLayout } from './lod-height-bake';
import { runBake, type BakeOutput, type BakedSourceId } from './lod-height-noise';
import type { CellPlanetDescription } from './lod-height-terrain';
import type { BakeRequest } from './lod-height-bake.worker';

/** A finished bake and the wall time the caller waited for it (worker start, world build, bake, transfer), ms. */
export interface BakeResult extends BakeOutput {
  readonly roundTripMs: number;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve(result: BakeResult): void; reject(error: Error): void; began: number }>();

function workerInstance(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./lod-height-bake.worker', import.meta.url), { type: 'module' });
  created.addEventListener('message', ({ data }: MessageEvent<Partial<BakeOutput> & { id: number; error?: string }>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.baked && data.probes) {
      entry.resolve({ baked: data.baked, probes: data.probes, worldBuildMs: data.worldBuildMs, roundTripMs: performance.now() - entry.began });
    } else entry.reject(new Error(data.error ?? 'Bake failed'));
  });
  created.addEventListener('error', (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || 'Bake worker failed'));
    pending.clear();
    created.terminate();
    worker = undefined;
  });
  worker = created;
  return created;
}

/**
 * Bakes a source in a Web Worker (the main thread stays free); without `Worker` it bakes inline. The result's arrays
 * are transferred, so the caller owns them. The cell planet is sent as its description and built in the worker.
 */
export function bakeInWorker(source: BakedSourceId, layout: BakeLayout, planet?: CellPlanetDescription): Promise<BakeResult> {
  if (typeof Worker === 'undefined') {
    const began = performance.now();
    const output = runBake(source, layout, planet);
    return Promise.resolve({ ...output, roundTripMs: performance.now() - began });
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, began: performance.now() });
    const request: BakeRequest = { id, source, layout, ...(planet ? { planet } : {}) };
    workerInstance().postMessage(request);
  });
}
