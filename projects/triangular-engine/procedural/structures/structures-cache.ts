import { BufferGeometry } from 'three';
import type { IStructureArchetype } from './structures-archetype';
import { buildStructureMesh } from './structures-mesh';
import { generateStructureSkeleton } from './structures-skeleton';

/**
 * High-performance memoized geometry cache for procedural structures.
 * Ensures that identical archetypes, seeds, and LOD tiers reuse a single GPU BufferGeometry across thousands of instances.
 */
export class StructureGeometryCache {
  private readonly cache = new Map<
    string,
    {
      geometry: BufferGeometry;
      refCount: number;
    }
  >();

  /**
   * Generates a deterministic hash key for an archetype, seed, and LOD level.
   */
  getCacheKey(archetype: IStructureArchetype, seed = 42, lod = 0): string {
    return `${archetype.id}-v${archetype.schemaVersion}-s${seed}-lod${lod}`;
  }

  /**
   * Retrieves an existing BufferGeometry from cache or builds and stores a new one.
   */
  getOrCreate(archetype: IStructureArchetype, seed = 42, lod = 0): BufferGeometry {
    const key = this.getCacheKey(archetype, seed, lod);
    const existing = this.cache.get(key);
    if (existing) {
      existing.refCount++;
      return existing.geometry;
    }

    const solids = generateStructureSkeleton(archetype, seed);
    const { geometry } = buildStructureMesh(solids, archetype, { lod });
    this.cache.set(key, { geometry, refCount: 1 });
    return geometry;
  }

  /**
   * Decrements reference count and disposes GPU buffers when count reaches zero.
   */
  release(archetype: IStructureArchetype, seed = 42, lod = 0): void {
    const key = this.getCacheKey(archetype, seed, lod);
    const entry = this.cache.get(key);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      entry.geometry.dispose();
      this.cache.delete(key);
    }
  }

  /**
   * Returns current count of cached unique BufferGeometries.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Disposes all cached geometries from GPU memory and clears the cache.
   */
  clear(): void {
    for (const entry of this.cache.values()) {
      entry.geometry.dispose();
    }
    this.cache.clear();
  }
}

/** Global default geometry cache instance for procedural structures */
export const defaultStructureGeometryCache = new StructureGeometryCache();
