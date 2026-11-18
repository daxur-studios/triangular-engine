# triangular-engine/cache

Framework-free persistent caching for deterministic generated data. This entry can be used in a web worker.

`createPersistentCache` keeps a synchronous in-memory copy and optionally stores entries in IndexedDB. Await `preload(keys)` before reading stored entries; unavailable storage falls back to memory. Use versioned keys that include the full generation recipe.
