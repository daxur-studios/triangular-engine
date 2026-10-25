import { bakeHeights, type BakeLayout, type BakedHeights } from './lod-height-bake';
import { samplerFor, type BakedSourceId } from './lod-height-noise';
import type { BakeRequest } from './lod-height-bake.worker';

/** A finished bake and the wall time the caller waited for it (worker start, bake, transfer), ms. */
export interface BakeResult {
  readonly baked: BakedHeights;
  readonly roundTripMs: number;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve(result: BakeResult): void; reject(error: Error): void; began: number }>();

function workerInstance(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./lod-height-bake.worker', import.meta.url), { type: 'module' });
  created.addEventListener('message', ({ data }: MessageEvent<{ id: number; baked?: BakedHeights; error?: string }>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.baked) entry.resolve({ baked: data.baked, roundTripMs: performance.now() - entry.began });
    else entry.reject(new Error(data.error ?? 'Bake failed'));
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
 * are transferred, so the caller owns them.
 */
export function bakeInWorker(source: BakedSourceId, layout: BakeLayout): Promise<BakeResult> {
  if (typeof Worker === 'undefined') {
    const began = performance.now();
    const baked = bakeHeights(layout, samplerFor(source, layout));
    return Promise.resolve({ baked, roundTripMs: performance.now() - began });
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, began: performance.now() });
    const request: BakeRequest = { id, source, layout };
    workerInstance().postMessage(request);
  });
}
