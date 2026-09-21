import type { ITerrainMaterialTileAddress, ITerrainMaterialTilePayload } from './terrain-material-tile';
import { materialTileAddressKey } from './terrain-material-tile-selector';

export interface ITerrainMaterialResidentPage {
  readonly address: ITerrainMaterialTileAddress;
  readonly slot: number;
  lastUse: number;
}

/** Bounded, single-flight material scheduler. Providers own worker execution. */
export class TerrainMaterialTileStream {
  readonly resident = new Map<string, ITerrainMaterialResidentPage>();
  private desired: readonly ITerrainMaterialTileAddress[] = [];
  private protectedKeys = new Set<string>();
  private epoch = 0;
  private clock = 0;
  private busy = false;
  private disposed = false;
  private failed = new Set<string>();
  completed = 0;
  discarded = 0;
  lastError: string | undefined;

  constructor(private readonly options: {
    readonly capacity: number;
    readonly request: (address: ITerrainMaterialTileAddress) => Promise<ITerrainMaterialTilePayload>;
    /** Called synchronously with the new residency map, before rendering. */
    readonly publish: (payload: ITerrainMaterialTilePayload, slot: number,
      resident: ReadonlyMap<string, ITerrainMaterialResidentPage>) => void;
  }) {
    if (!Number.isInteger(options.capacity) || options.capacity < 2 || options.capacity > 128) {
      throw new RangeError('Material page capacity must be 2–128.');
    }
  }

  get inFlight(): number { return this.busy ? 1 : 0; }
  get queued(): number {
    return this.desired.filter(a => !this.resident.has(materialTileAddressKey(a)) &&
      !this.failed.has(materialTileAddressKey(a))).length;
  }

  update(addresses: readonly ITerrainMaterialTileAddress[]): void {
    if (this.disposed) return;
    if (addresses.length >= this.options.capacity) throw new RangeError('Desired pages need spare cache capacity.');
    for (const a of addresses) {
      if (!Number.isInteger(a.level) || a.level < 0 || a.level > 10 ||
        !Number.isInteger(a.x) || !Number.isInteger(a.y) ||
        a.x < 0 || a.y < 0 || a.x >= 2 ** a.level || a.y >= 2 ** a.level || a.face !== undefined) {
        throw new RangeError('Material stream supports unit-square addresses at levels 0–10.');
      }
    }
    this.desired = addresses;
    this.protectedKeys = new Set(addresses.map(materialTileAddressKey));
    this.protectedKeys.add('0/0/0');
    for (const key of this.protectedKeys) {
      const page = this.resident.get(key);
      if (page) page.lastUse = ++this.clock;
    }
    this.pump();
  }

  /** Only world/style changes invalidate data, never camera or mesh changes. */
  invalidate(): void {
    this.epoch++;
    this.resident.clear();
    this.failed.clear();
    this.lastError = undefined;
    this.desired = [];
  }

  dispose(): void { this.disposed = true; this.invalidate(); }

  private pump(): void {
    if (this.busy || this.disposed) return;
    const address = this.desired.find(a => {
      const key = materialTileAddressKey(a);
      return !this.resident.has(key) && !this.failed.has(key);
    });
    if (!address) return;
    const key = materialTileAddressKey(address);
    const epoch = this.epoch;
    this.busy = true;
    void Promise.resolve().then(() => this.options.request(address)).then(payload => {
      if (this.disposed || epoch !== this.epoch || !this.protectedKeys.has(key)) {
        this.discarded++;
        return;
      }
      if (materialTileAddressKey(payload.identity.address) !== key) throw new Error('Material tile address mismatch.');
      const next = new Map(this.resident);
      const usedSlots = new Set([...next.values()].map(page => page.slot));
      let slot = 0;
      while (usedSlots.has(slot)) slot++;
      if (slot >= this.options.capacity) {
        const victim = [...next.entries()]
          .filter(([k]) => !this.protectedKeys.has(k))
          .sort((a, b) => a[1].lastUse - b[1].lastUse)[0];
        if (!victim) throw new Error('No unpinned material page available.');
        slot = victim[1].slot;
        next.delete(victim[0]);
      }
      next.set(key, { address, slot, lastUse: ++this.clock });
      this.options.publish(payload, slot, next);
      this.resident.clear();
      for (const [k, page] of next) this.resident.set(k, page);
      this.completed++;
    }).catch(error => {
      if (epoch === this.epoch && !this.disposed) {
        this.lastError = String(error);
        this.failed.add(key);
        // Error history is bounded too, including a failed provider during travel.
        if (this.failed.size > this.options.capacity) this.failed.delete(this.failed.values().next().value!);
        this.resident.delete(key);
      }
    }).finally(() => {
      this.busy = false;
      // One completion per task; never flood the worker with the full desired set.
      this.pump();
    });
  }
}
