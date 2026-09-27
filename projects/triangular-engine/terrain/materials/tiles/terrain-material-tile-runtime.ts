import type {
  ITerrainMaterialTileAddress,
  ITerrainMaterialTilePayload,
} from './terrain-material-tile';
import { TerrainMaterialTileGpu } from './terrain-material-tile-gpu';
import {
  TerrainMaterialTileStream,
  type ITerrainMaterialResidentPage,
} from './terrain-material-tile-stream';

export interface ITerrainMaterialTileRuntimeOptions {
  readonly request: (
    address: ITerrainMaterialTileAddress,
  ) => Promise<ITerrainMaterialTilePayload>;
  /** Maximum resident pages; the GPU adapter's hard maximum is 128. */
  readonly capacity?: number;
  readonly onPublish?: (
    payload: ITerrainMaterialTilePayload,
    resident: ReadonlyMap<string, ITerrainMaterialResidentPage>,
  ) => void;
}

export interface ITerrainMaterialTileRuntimeStats {
  readonly resident: number;
  readonly queued: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly discarded: number;
  readonly maxLevel: number;
  readonly allocatedBytes: number;
  readonly uploadedBytes: number;
  readonly error: string;
}

/** One consumer-owned adapter for the shared GPU tile pool and bounded request stream. */
export class TerrainMaterialTileRuntime {
  readonly gpu: TerrainMaterialTileGpu;
  private readonly stream: TerrainMaterialTileStream;
  private showMaterial = true;
  private disposed = false;

  constructor(options: ITerrainMaterialTileRuntimeOptions) {
    this.gpu = new TerrainMaterialTileGpu();
    const capacity = options.capacity ?? this.gpu.capacity;
    if (capacity > this.gpu.capacity) {
      throw new RangeError(
        'Material stream capacity cannot exceed its GPU page capacity.',
      );
    }
    this.stream = new TerrainMaterialTileStream({
      capacity,
      request: options.request,
      publish: (payload, slot, resident) => {
        this.gpu.publish(payload, slot, resident);
        this.syncEnabled(resident);
        options.onPublish?.(payload, resident);
      },
    });
  }

  /** Applies a view cut to both GPU fallback mapping and the bounded request stream. */
  update(addresses: readonly ITerrainMaterialTileAddress[]): void {
    if (this.disposed) return;
    const root = addresses.find((address) => address.level === 0);
    const selection =
      addresses.length > 0 && !root
        ? [{ level: 0, x: 0, y: 0 }, ...addresses]
        : addresses;
    this.gpu.setSelection(selection, this.stream.resident);
    this.stream.update(selection);
    this.syncEnabled();
  }

  /** Changes to world/style invalidate baked pages; camera movement should call `update` instead. */
  invalidate(): void {
    if (this.disposed) return;
    this.stream.invalidate();
    this.gpu.setSelection([], this.stream.resident);
    this.gpu.enabled.value = 0;
  }

  setEnabled(enabled: boolean): void {
    this.showMaterial = enabled;
    this.syncEnabled();
  }

  get stats(): ITerrainMaterialTileRuntimeStats {
    return {
      resident: this.stream.resident.size,
      queued: this.stream.queued,
      inFlight: this.stream.inFlight,
      completed: this.stream.completed,
      discarded: this.stream.discarded,
      maxLevel: Math.max(
        0,
        ...[...this.stream.resident.values()].map((page) => page.address.level),
      ),
      allocatedBytes: this.gpu.allocatedBytes,
      uploadedBytes: this.gpu.uploadedBytes,
      error: this.stream.lastError ?? '',
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stream.dispose();
    this.gpu.dispose();
  }

  private syncEnabled(
    resident: ReadonlyMap<string, ITerrainMaterialResidentPage> = this.stream
      .resident,
  ): void {
    this.gpu.enabled.value = this.showMaterial && resident.has('0/0/0') ? 1 : 0;
  }
}
