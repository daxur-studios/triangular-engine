/**
 * A small cache for slow, deterministic CPU results (baked lookup tables, generated planet graphs).
 *
 * The generators that use it are synchronous, but IndexedDB is not. So reads go to a plain in-memory
 * `Map`, and `preload(keys)` fills that map from IndexedDB before the generator runs. A miss costs
 * nothing extra: the generator computes, `set` keeps the result in memory, and the write to IndexedDB
 * happens in the background.
 *
 * IndexedDB belongs to the origin, so every game and page on that origin shares the stored results.
 * Keys must be the full recipe plus a version string, so a change to the generator never reads stale data.
 * Everything fails soft: with no IndexedDB (SSR, private window, quota) the cache is memory only.
 */

const DB_NAME = 'triangular-engine-cache';
const DB_VERSION = 1;
const STORE = 'entries';
const NAMESPACE_INDEX = 'by-namespace-use';

interface IStoredEntry<T> {
  /** `${namespace}\u0000${key}`, the record key. */
  readonly id: string;
  readonly namespace: string;
  readonly usedAt: number;
  readonly value: T;
}

export interface IPersistentCacheOptions {
  /** Separates one kind of result from another (for example `atmosphere-luts`). */
  readonly namespace: string;
  /** Oldest-used entries beyond this count are deleted from IndexedDB. */
  readonly maxEntries: number;
}

export interface IPersistentCache<T> {
  /** The result if it is in memory (computed this session or preloaded); never touches IndexedDB. */
  get(key: string): T | undefined;
  /** Keeps the result in memory and writes it to IndexedDB in the background. */
  set(key: string, value: T): void;
  /** Loads the given keys from IndexedDB into memory. Resolves even when storage is unavailable. */
  preload(keys: readonly string[]): Promise<void>;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex(NAMESPACE_INDEX, ['namespace', 'usedAt']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function request<R>(req: IDBRequest<R>): Promise<R | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export function createPersistentCache<T>(options: IPersistentCacheOptions): IPersistentCache<T> {
  const { namespace, maxEntries } = options;
  const memory = new Map<string, T>();
  const recordId = (key: string) => `${namespace}\u0000${key}`;

  async function evict(db: IDBDatabase): Promise<void> {
    const transaction = db.transaction(STORE, 'readwrite');
    const index = transaction.objectStore(STORE).index(NAMESPACE_INDEX);
    const range = IDBKeyRange.bound([namespace, 0], [namespace, Number.MAX_SAFE_INTEGER]);
    const total = (await request(index.count(range))) ?? 0;
    let excess = total - maxEntries;
    if (excess > 0) {
      // The index orders by use time, so the cursor starts at the least recently used entry.
      const cursor = index.openKeyCursor(range);
      await new Promise<void>((resolve) => {
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at || excess <= 0) return resolve();
          transaction.objectStore(STORE).delete(at.primaryKey);
          excess -= 1;
          at.continue();
        };
        cursor.onerror = () => resolve();
      });
    }
    await done(transaction);
  }

  return {
    get: (key) => memory.get(key),

    set(key, value) {
      memory.set(key, value);
      void openDb().then(async (db) => {
        if (!db) return;
        try {
          const transaction = db.transaction(STORE, 'readwrite');
          const entry: IStoredEntry<T> = { id: recordId(key), namespace, usedAt: Date.now(), value };
          transaction.objectStore(STORE).put(entry);
          await done(transaction);
          await evict(db);
        } catch {
          // Quota or a closed database: the in-memory copy still serves this session.
        }
      });
    },

    async preload(keys) {
      const missing = keys.filter((key) => !memory.has(key));
      if (missing.length === 0) return;
      const db = await openDb();
      if (!db) return;
      try {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const reads = missing.map(async (key) => {
          const entry = (await request(store.get(recordId(key)))) as IStoredEntry<T> | undefined;
          if (!entry) return;
          memory.set(key, entry.value);
          store.put({ ...entry, usedAt: Date.now() });
        });
        await Promise.all(reads);
        await done(transaction);
      } catch {
        // Unreadable storage behaves like a miss.
      }
    },
  };
}
