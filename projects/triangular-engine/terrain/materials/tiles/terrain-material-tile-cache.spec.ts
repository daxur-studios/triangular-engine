import { TerrainMaterialTileCache } from './terrain-material-tile-cache';
import type { ITerrainMaterialTilePayload } from './terrain-material-tile';

function payload(id: string, bytes: number): ITerrainMaterialTilePayload {
  return {
    identity: {
      worldRevision: id,
      address: { level: 0, x: 0, y: 0 },
      styleRevision: 'style',
      samplingVersion: 1,
      format: 'rgba8-linear',
    },
    interiorSize: 2,
    gutterSize: 0,
    width: 2,
    height: 2,
    mipData: [new Uint8Array(bytes)],
    byteLength: bytes,
  };
}

describe('TerrainMaterialTileCache', () => {
  it('evicts the least recently used unpinned payload within the byte budget', () => {
    const cache = new TerrainMaterialTileCache(8);
    cache.set('a', payload('a', 4));
    cache.set('b', payload('b', 4));
    cache.get('a');
    const evicted = cache.set('c', payload('c', 4));

    expect(evicted.map((item) => item.identity.worldRevision)).toEqual(['b']);
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.byteLength).toBe(8);
  });

  it('keeps pinned fallback tiles resident', () => {
    const cache = new TerrainMaterialTileCache(8);
    cache.set('root', payload('root', 4), true);
    cache.set('child', payload('child', 4));
    const evicted = cache.set('next', payload('next', 4));

    expect(evicted.map((item) => item.identity.worldRevision)).toEqual(['child']);
    expect(cache.get('root')).toBeDefined();
  });
});
