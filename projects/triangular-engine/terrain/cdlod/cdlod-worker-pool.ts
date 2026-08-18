import { ICelestialBody, Vec3d } from 'triangular-engine/celestial';
import { IPlanetPatchAddress } from './cdlod-quadtree';
import {
  CdlodPatchType,
  ICdlodWorkerRequest,
  ICdlodWorkerResponse,
} from './cdlod-worker-protocol';
import { ICdlodRawPatchBuffers } from './cdlod-patch-mesher';

export interface ICdlodWorkerJob {
  id: string;
  type: CdlodPatchType;
  body: ICelestialBody;
  address: IPlanetPatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
}

export interface ICdlodWorkerPoolOptions {
  workerCount?: number;
  workerFactory?: () => Worker;
}

interface IWorkerSlot {
  worker: Worker;
  busy: boolean;
  currentRequestId?: string;
}

export class CdlodWorkerPool {
  readonly #slots: IWorkerSlot[] = [];
  readonly #queue: ICdlodWorkerRequest[] = [];
  readonly #inFlight = new Map<
    string,
    {
      request: ICdlodWorkerRequest;
      resolve: (raw: ICdlodRawPatchBuffers) => void;
      reject: (err: Error) => void;
    }
  >();
  #requestCounter = 0;
  #isTerminated = false;
  readonly #workerFactory?: () => Worker;

  constructor(
    optionsOrCount: number | ICdlodWorkerPoolOptions = Math.min(
      4,
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    ),
  ) {
    const options: ICdlodWorkerPoolOptions =
      typeof optionsOrCount === 'number'
        ? { workerCount: optionsOrCount }
        : optionsOrCount;

    const count =
      options.workerCount ??
      Math.min(
        4,
        typeof navigator !== 'undefined'
          ? navigator.hardwareConcurrency || 4
          : 4,
      );

    this.#workerFactory = options.workerFactory;

    if (typeof Worker !== 'undefined') {
      for (let i = 0; i < count; i++) {
        try {
          this.#slots.push(this.#createWorkerSlot());
        } catch {
          // If browser environment or build forbids worker creation at runtime, slots stay empty
          break;
        }
      }
    }
  }

  get isAvailable(): boolean {
    return this.#slots.length > 0 && !this.#isTerminated;
  }

  #createWorkerSlot(): IWorkerSlot {
    const slot: IWorkerSlot = {
      worker: undefined as unknown as Worker,
      busy: false,
    };

    const worker = this.#workerFactory
      ? this.#workerFactory()
      : new Worker(new URL('./cdlod-patch.worker', import.meta.url), {
          type: 'module',
        });

    worker.onmessage = (event: MessageEvent<ICdlodWorkerResponse>) => {
      this.#onWorkerResponse(slot, event.data);
    };

    worker.onerror = (err) => {
      console.error('[CdlodWorkerPool] Worker error:', err);
      slot.busy = false;
      this.#dispatchNext();
    };

    slot.worker = worker;
    return slot;
  }

  requestPatch(job: ICdlodWorkerJob): Promise<ICdlodRawPatchBuffers> {
    if (this.#isTerminated) {
      return Promise.reject(new Error('CdlodWorkerPool is terminated'));
    }

    if (this.#slots.length === 0) {
      return Promise.reject(new Error('Web Workers not available in this environment'));
    }

    const requestId = `${job.id}@${++this.#requestCounter}`;
    const request: ICdlodWorkerRequest = {
      ...job,
      requestId,
    };

    return new Promise<ICdlodRawPatchBuffers>((resolve, reject) => {
      this.#inFlight.set(requestId, { request, resolve, reject });
      this.#queue.push(request);
      this.#dispatchNext();
    });
  }

  #dispatchNext(): void {
    if (this.#queue.length === 0 || this.#isTerminated) return;
    const idleSlot = this.#slots.find((s) => !s.busy);
    if (!idleSlot) return;

    const request = this.#queue.shift()!;
    idleSlot.busy = true;
    idleSlot.currentRequestId = request.requestId;
    idleSlot.worker.postMessage(request);
  }

  #onWorkerResponse(slot: IWorkerSlot, response: ICdlodWorkerResponse): void {
    slot.busy = false;
    slot.currentRequestId = undefined;

    const pending = this.#inFlight.get(response.requestId);
    if (pending) {
      this.#inFlight.delete(response.requestId);
      if (response.success && response.raw) {
        pending.resolve(response.raw);
      } else {
        pending.reject(
          new Error(response.errorMessage || 'Worker patch generation failed'),
        );
      }
    }

    this.#dispatchNext();
  }

  terminate(): void {
    this.#isTerminated = true;
    this.#queue.length = 0;
    for (const pending of this.#inFlight.values()) {
      pending.reject(new Error('CdlodWorkerPool terminated'));
    }
    this.#inFlight.clear();
    for (const slot of this.#slots) {
      slot.worker?.terminate();
    }
    this.#slots.length = 0;
  }
}
