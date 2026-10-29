import { createBakeClient } from 'triangular-engine/lod-surface/core';

/** Bakes a source in the lab's worker (`lod-height-bake.worker.ts`); inline without `Worker`. See `createBakeClient`. */
export const bakeInWorker = createBakeClient(() => new Worker(new URL('./lod-height-bake.worker', import.meta.url), { type: 'module' }));
