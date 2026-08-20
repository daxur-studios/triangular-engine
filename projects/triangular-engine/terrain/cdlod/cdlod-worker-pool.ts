import {
  ICelestialBody,
  Vec3d,
  IPlanetPatchAddress,
  IPlanePatchAddress,
  ICylinderPatchAddress,
  CdlodPatchType,
  ICdlodWorkerRequest,
  ICdlodWorkerResponse,
  ICdlodRawPatchBuffers,
} from 'triangular-engine/celestial';

export interface ICdlodWorkerJob {
  id: string;
  type: CdlodPatchType;
  body?: ICelestialBody;
  address: IPlanetPatchAddress | IPlanePatchAddress | ICylinderPatchAddress;
  resolution: number;
  centerBodyFixedM: Vec3d;
  rootPatchSizeM?: number;
  radiusM?: number;
  rootSectors?: number;
  rootPatchLengthM?: number;
}

export interface ICdlodWorkerPoolOptions {
  workerCount?: number;
  workerFactory?: () => Worker;
}

interface IWorkerSlot {
  worker: Worker;
  busy: boolean;
  currentRequestId?: string;
  failed?: boolean;
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
          const slot = this.#createWorkerSlot();
          if (slot) {
            this.#slots.push(slot);
          }
        } catch {
          // If browser environment or build forbids worker creation at runtime, slots stay empty
          break;
        }
      }
    }
  }

  get isAvailable(): boolean {
    return this.#slots.some((s) => !s.failed) && !this.#isTerminated;
  }

  #createWorkerSlot(): IWorkerSlot | undefined {
    const slot: IWorkerSlot = {
      worker: undefined as unknown as Worker,
      busy: false,
    };

    try {
      const worker = this.#workerFactory
        ? this.#workerFactory()
        : new Worker(new URL('./cdlod-patch.worker', import.meta.url), {
            type: 'module',
          });

      worker.onmessage = (event: MessageEvent<ICdlodWorkerResponse>) => {
        this.#onWorkerResponse(slot, event.data);
      };

      worker.onerror = (err) => {
        slot.failed = true;
        slot.busy = false;
        if (slot.currentRequestId) {
          const pending = this.#inFlight.get(slot.currentRequestId);
          if (pending) {
            this.#inFlight.delete(slot.currentRequestId);
            pending.reject(new Error('Worker script execution failed'));
          }
          slot.currentRequestId = undefined;
        }
        this.#dispatchNext();
      };

      slot.worker = worker;
      return slot;
    } catch {
      return undefined;
    }
  }

  requestPatch(job: ICdlodWorkerJob): Promise<ICdlodRawPatchBuffers> {
    if (this.#isTerminated) {
      return Promise.reject(new Error('CdlodWorkerPool is terminated'));
    }

    if (!this.isAvailable) {
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
    const idleSlot = this.#slots.find((s) => !s.busy && !s.failed);
    if (!idleSlot) return;

    const request = this.#queue.shift()!;
    idleSlot.busy = true;
    idleSlot.currentRequestId = request.requestId;
    try {
      idleSlot.worker.postMessage(request);
    } catch (err) {
      idleSlot.failed = true;
      idleSlot.busy = false;
      const pending = this.#inFlight.get(request.requestId);
      if (pending) {
        this.#inFlight.delete(request.requestId);
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      this.#dispatchNext();
    }
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
      try {
        slot.worker?.terminate();
      } catch {
        // ignore
      }
    }
    this.#slots.length = 0;
  }

  destroy(): void {
    this.terminate();
  }
}
