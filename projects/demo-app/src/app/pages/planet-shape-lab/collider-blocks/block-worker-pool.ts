import type { DensityBlockSpec } from './block-grid';
import type { ColliderBlockReply, ColliderBlockRequest } from './collider-block-messages';
import type { SurfaceNetsMesh } from './surface-nets';

/** Kept apart from cpu-density-block.ts, which the worker imports: the worker must not reach its own constructor. */

export interface BlockTiming {
  /** Wall time from the call to the reply on the main thread, including queueing behind other jobs. */
  roundTripMs: number;
  /** Time inside the worker. */
  sampleMs: number;
  meshMs: number;
}

interface Pending {
  resolve(reply: ColliderBlockReply): void;
  reject(error: Error): void;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** A fixed set of module workers running `collider-block.worker.ts`, each taking one job at a time, first in first out. */
export class ColliderBlockWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: { request: ColliderBlockRequest; transfer: Transferable[]; pending: Pending }[] = [];
  private readonly running = new Map<Worker, Pending>();
  private nextId = 1;

  constructor(readonly size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./collider-block.worker', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ColliderBlockReply>) => this.onReply(worker, event.data);
      worker.onerror = (event) => this.onFailure(worker, new Error(event.message || 'collider block worker failed'));
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** Run a request (its `id` is assigned here) and resolve with the reply. */
  run(request: DistributiveOmit<ColliderBlockRequest, 'id'>, transfer: Transferable[] = []): Promise<ColliderBlockReply> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request: { ...request, id: this.nextId++ } as ColliderBlockRequest, transfer, pending: { resolve, reject } });
      this.pump();
    });
  }

  get queued(): number {
    return this.queue.length;
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    for (const job of this.queue.splice(0)) job.pending.reject(new Error('pool disposed'));
    for (const pending of this.running.values()) pending.reject(new Error('pool disposed'));
    this.running.clear();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop() as Worker;
      const job = this.queue.shift() as (typeof this.queue)[number];
      this.running.set(worker, job.pending);
      worker.postMessage(job.request, job.transfer);
    }
  }

  private onReply(worker: Worker, reply: ColliderBlockReply): void {
    const pending = this.running.get(worker);
    this.running.delete(worker);
    this.idle.push(worker);
    if (pending) {
      if (reply.kind === 'error') pending.reject(new Error(reply.message));
      else pending.resolve(reply);
    }
    this.pump();
  }

  private onFailure(worker: Worker, error: Error): void {
    const pending = this.running.get(worker);
    this.running.delete(worker);
    pending?.reject(error);
  }
}

/** Sample one block in a pool worker. The grid arrives as a transferred buffer. */
export async function sampleDensityBlockInWorker(pool: ColliderBlockWorkerPool, spec: DensityBlockSpec): Promise<{ grid: Float32Array; timing: BlockTiming }> {
  const t0 = performance.now();
  const reply = await pool.run({ kind: 'sample', spec });
  if (reply.kind !== 'sample') throw new Error(`unexpected reply ${reply.kind}`);
  return { grid: reply.grid, timing: { roundTripMs: performance.now() - t0, sampleMs: reply.sampleMs, meshMs: 0 } };
}

/** Mesh a density grid in a pool worker (the buffer is transferred, so `grid` is detached afterwards). */
export async function meshDensityBlockInWorker(pool: ColliderBlockWorkerPool, grid: Float32Array, voxelM: number): Promise<{ mesh: SurfaceNetsMesh; timing: BlockTiming }> {
  const t0 = performance.now();
  const reply = await pool.run({ kind: 'mesh', grid, voxelM }, [grid.buffer]);
  if (reply.kind !== 'mesh') throw new Error(`unexpected reply ${reply.kind}`);
  return { mesh: reply.mesh, timing: { roundTripMs: performance.now() - t0, sampleMs: 0, meshMs: reply.meshMs } };
}

/** Sample and mesh in one worker job: the CPU path's whole cost per block. */
export async function sampleAndMeshInWorker(pool: ColliderBlockWorkerPool, spec: DensityBlockSpec): Promise<{ mesh: SurfaceNetsMesh; timing: BlockTiming }> {
  const t0 = performance.now();
  const reply = await pool.run({ kind: 'sample-mesh', spec });
  if (reply.kind !== 'sample-mesh') throw new Error(`unexpected reply ${reply.kind}`);
  return { mesh: reply.mesh, timing: { roundTripMs: performance.now() - t0, sampleMs: reply.sampleMs, meshMs: reply.meshMs } };
}
