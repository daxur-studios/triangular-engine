import { createPersistentCache } from './persistent-cache';

const unique = () => `spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const settle = (ms = 150) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('createPersistentCache', () => {
  it('returns what was set from memory at once', () => {
    const cache = createPersistentCache<number>({ namespace: unique(), maxEntries: 4 });
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('preloads a stored value into a fresh cache of the same namespace', async () => {
    const namespace = unique();
    createPersistentCache<{ n: number }>({ namespace, maxEntries: 4 }).set('k', { n: 7 });
    await settle();
    const second = createPersistentCache<{ n: number }>({ namespace, maxEntries: 4 });
    expect(second.get('k')).toBeUndefined();
    await second.preload(['k', 'missing']);
    expect(second.get('k')).toEqual({ n: 7 });
    expect(second.get('missing')).toBeUndefined();
  });

  it('keeps namespaces apart', async () => {
    const a = unique();
    createPersistentCache<number>({ namespace: a, maxEntries: 4 }).set('k', 1);
    await settle();
    const other = createPersistentCache<number>({ namespace: unique(), maxEntries: 4 });
    await other.preload(['k']);
    expect(other.get('k')).toBeUndefined();
  });

  it('evicts the least recently used entries beyond maxEntries', async () => {
    const namespace = unique();
    const writer = createPersistentCache<number>({ namespace, maxEntries: 2 });
    writer.set('old', 1);
    await settle();
    writer.set('mid', 2);
    await settle();
    writer.set('new', 3);
    await settle(300);
    const reader = createPersistentCache<number>({ namespace, maxEntries: 2 });
    await reader.preload(['old', 'mid', 'new']);
    expect(reader.get('old')).toBeUndefined();
    expect(reader.get('mid')).toBe(2);
    expect(reader.get('new')).toBe(3);
  });
});
