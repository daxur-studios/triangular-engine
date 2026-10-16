/** One named, ordered entry of a {@link OrderedSlots} stack. */
export interface ISlotEntry<T> {
  readonly id: string;
  readonly order: number;
  readonly value: T;
}

/**
 * An ordered registry of named entries: the shape every `PlanetSurfaceMaterial` stage stack
 * (surface layers, sun occluders, emissives) shares.
 *
 * - Entries run in ascending `order`; equal orders keep insertion order.
 * - {@link key} is built from the entry ids alone, in run order. It is the shader cache key, so
 *   changing a uniform value never changes it, while adding, removing or reordering an entry does.
 */
export class OrderedSlots<T> {
  private readonly slots: ISlotEntry<T>[] = [];

  add(entry: ISlotEntry<T>): void {
    if (this.slots.some((slot) => slot.id === entry.id)) {
      throw new Error(`Planet material slot "${entry.id}" already exists`);
    }
    // Insert after every entry with an order <= this one, so ties keep insertion order.
    let at = this.slots.length;
    while (at > 0 && this.slots[at - 1].order > entry.order) at -= 1;
    this.slots.splice(at, 0, entry);
  }

  remove(id: string): boolean {
    const at = this.slots.findIndex((slot) => slot.id === id);
    if (at < 0) return false;
    this.slots.splice(at, 1);
    return true;
  }

  has(id: string): boolean {
    return this.slots.some((slot) => slot.id === id);
  }

  get entries(): readonly ISlotEntry<T>[] {
    return this.slots;
  }

  get size(): number {
    return this.slots.length;
  }

  /** Entry ids in run order, e.g. `"roads|decals"`. */
  key(): string {
    return this.slots.map((slot) => slot.id).join('|');
  }
}
