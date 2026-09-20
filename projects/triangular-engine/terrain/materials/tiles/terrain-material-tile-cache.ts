import type { ITerrainMaterialTilePayload } from './terrain-material-tile';

interface ICacheEntry<TPayload extends ITerrainMaterialTilePayload> {
  payload: TPayload;
  pinned: boolean;
  lastUse: number;
}

/** Bounded byte-counted LRU cache for CPU-side material tile payloads. */
export class TerrainMaterialTileCache<
  TPayload extends ITerrainMaterialTilePayload = ITerrainMaterialTilePayload,
> {
  private readonly entries = new Map<string, ICacheEntry<TPayload>>();
  private clock = 0;
  private bytes = 0;

  constructor(readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('Terrain material tile cache maxBytes must be positive.');
    }
  }

  get byteLength(): number {
    return this.bytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): TPayload | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastUse = ++this.clock;
    return entry.payload;
  }

  set(key: string, payload: TPayload, pinned = false): readonly TPayload[] {
    if (payload.byteLength > this.maxBytes) {
      throw new RangeError('Terrain material tile is larger than the cache budget.');
    }
    const old = this.entries.get(key);
    if (old) this.bytes -= old.payload.byteLength;
    this.entries.set(key, {
      payload,
      pinned: pinned || old?.pinned === true,
      lastUse: ++this.clock,
    });
    this.bytes += payload.byteLength;
    return this.evict();
  }

  pin(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.pinned = true;
    entry.lastUse = ++this.clock;
    return true;
  }

  unpin(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.pinned = false;
    entry.lastUse = ++this.clock;
    return true;
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.payload.byteLength;
    this.entries.delete(key);
    return true;
  }

  clear(): readonly TPayload[] {
    const removed = [...this.entries.values()].map(({ payload }) => payload);
    this.entries.clear();
    this.bytes = 0;
    return removed;
  }

  private evict(): readonly TPayload[] {
    const evicted: TPayload[] = [];
    while (this.bytes > this.maxBytes) {
      let oldestKey: string | undefined;
      let oldestUse = Infinity;
      for (const [key, entry] of this.entries) {
        if (!entry.pinned && entry.lastUse < oldestUse) {
          oldestKey = key;
          oldestUse = entry.lastUse;
        }
      }
      if (oldestKey === undefined) {
        throw new RangeError('Pinned terrain material tiles exceed the cache budget.');
      }
      const entry = this.entries.get(oldestKey)!;
      this.bytes -= entry.payload.byteLength;
      this.entries.delete(oldestKey);
      evicted.push(entry.payload);
    }
    return evicted;
  }
}
