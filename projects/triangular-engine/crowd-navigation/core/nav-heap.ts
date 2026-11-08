/**
 * A binary min-heap of integer values ordered by a float key, backed by typed arrays. Internal to
 * the crowd-navigation entry (not exported from `public-api.ts`). Duplicate values are allowed;
 * callers skip stale entries (lazy deletion).
 */
export class NavMinHeap {
  private keys = new Float64Array(256);
  private vals = new Int32Array(256);
  private count = 0;

  /** Number of entries. */
  get size(): number {
    return this.count;
  }

  /** Removes every entry. */
  clear(): void {
    this.count = 0;
  }

  /** The smallest key. Only valid when `size > 0`. */
  peekKey(): number {
    return this.keys[0];
  }

  /** Adds a value with a key. */
  push(key: number, value: number): void {
    if (this.count === this.keys.length) {
      const keys = new Float64Array(this.count * 2);
      keys.set(this.keys);
      this.keys = keys;
      const vals = new Int32Array(this.count * 2);
      vals.set(this.vals);
      this.vals = vals;
    }
    const keys = this.keys;
    const vals = this.vals;
    let i = this.count++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = value;
  }

  /** Removes and returns the value with the smallest key. Only valid when `size > 0`. */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const n = --this.count;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
