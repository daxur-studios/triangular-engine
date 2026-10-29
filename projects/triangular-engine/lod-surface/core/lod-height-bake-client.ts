import { bakeBuffers, type BakeLayout } from './lod-height-bake';
import { runBake, type BakeOutput, type BakedSourceId } from './lod-height-noise';
import { parseCellPlanet, type CellPlanetDescription } from './lod-height-terrain';

/**
 * Baking in a Web Worker without shipping a worker file. A library cannot bundle a worker for the app, so the app owns a
 * one-line worker file that calls {@link serveBakeRequests}, and gives {@link createBakeClient} a factory for it:
 *
 * ```ts
 * // height-bake.worker.ts
 * import { serveBakeRequests } from 'triangular-engine/lod-surface/core';
 * serveBakeRequests(self);
 *
 * // wherever the bake is started
 * const bake = createBakeClient(() => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }));
 * const { baked } = await bake('noise', layout);
 * ```
 *
 * The worker file must import `triangular-engine/lod-surface/core`, never the `triangular-engine/lod-surface` entry:
 * the core entry has no Angular code, which an app's worker bundle cannot link.
 */

/**
 * One bake: the source by name (functions do not cross `postMessage`), the texture layout and, for the cell planet, the
 * plain description the worker builds its world from.
 */
export interface BakeRequest {
  /** Matches the reply to the request. */
  readonly id: number;
  readonly source: BakedSourceId;
  readonly layout: BakeLayout;
  readonly planet?: CellPlanetDescription;
}

/** The worker's reply: a finished bake with the request's id, or an error message. */
export type BakeReply = (BakeOutput & { readonly id: number }) | { readonly id: number; readonly error: string };

/** The part of a worker global scope that {@link serveBakeRequests} uses. */
export interface BakeWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<BakeRequest>) => void): void;
  postMessage(message: BakeReply, transfer: Transferable[]): void;
}

/**
 * Runs one request exactly as the worker does, so the inline fallback and the specs share the code. Returns the reply and
 * the buffers to transfer with it; a failing bake becomes an error reply.
 */
export function answerBakeRequest(request: BakeRequest): { readonly reply: BakeReply; readonly transfer: Transferable[] } {
  try {
    const output = runBake(request.source, request.layout, request.planet ? parseCellPlanet(request.planet) : undefined);
    return { reply: { id: request.id, ...output }, transfer: bakeBuffers(output.baked) };
  } catch (error) {
    return { reply: { id: request.id, error: error instanceof Error ? error.message : String(error) }, transfer: [] };
  }
}

/** Makes a worker global scope (`self`) answer bake requests from {@link createBakeClient}. Call it once from the worker file. */
export function serveBakeRequests(scope: BakeWorkerScope): void {
  scope.addEventListener('message', ({ data }) => {
    const { reply, transfer } = answerBakeRequest(data);
    scope.postMessage(reply, transfer);
  });
}

/** A finished bake and the wall time the caller waited for it (worker start, world build, bake, transfer), ms. */
export interface BakeResult extends BakeOutput {
  readonly roundTripMs: number;
}

/** Starts a bake and resolves when it is done; see {@link createBakeClient}. */
export type BakeClient = (source: BakedSourceId, layout: BakeLayout, planet?: CellPlanetDescription) => Promise<BakeResult>;

/**
 * A bake function that runs in the worker `createWorker` makes (created on first use, one worker for all bakes; a worker
 * error rejects the pending bakes and the next bake starts a new worker). Without `Worker` (a unit test, an old
 * environment) it bakes inline. The result's arrays are transferred, so the caller owns them. The cell planet is sent as
 * its description and built in the worker.
 */
export function createBakeClient(createWorker: () => Worker): BakeClient {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, { resolve(result: BakeResult): void; reject(error: Error): void; began: number }>();

  const instance = (): Worker => {
    if (worker) return worker;
    const created = createWorker();
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
  };

  return (source, layout, planet) => {
    if (typeof Worker === 'undefined') {
      const began = performance.now();
      const output = runBake(source, layout, planet);
      return Promise.resolve({ ...output, roundTripMs: performance.now() - began });
    }
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, began: performance.now() });
      const request: BakeRequest = { id, source, layout, ...(planet ? { planet } : {}) };
      instance().postMessage(request);
    });
  };
}
