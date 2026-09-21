import { TerrainMaterialTileStream } from './terrain-material-tile-stream';
import { materialTileAddressKey, selectTerrainMaterialTiles } from './terrain-material-tile-selector';
import { bakeTerrainMaterialTile } from './terrain-material-tile-baker';
import type { ITerrainMaterialTileAddress, ITerrainMaterialTilePayload } from './terrain-material-tile';

const root = { level: 0, x: 0, y: 0 };
const child = { level: 1, x: 0, y: 0 };
const other = { level: 1, x: 1, y: 0 };
function payload(address: ITerrainMaterialTileAddress) {
  return bakeTerrainMaterialTile({ address, worldRevision: 'test', styleRevision: '1', samplingVersion: 1, format: 'rgba8-linear' },
    { sample: () => [0.5, 0.5, 0.5] }, { interiorSize: 2, gutterSize: 0 });
}
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

describe('independent material streaming', () => {
  it('deduplicates repeated views and keeps high-detail pages while new work runs', async () => {
    const requests: string[] = [];
    let finish: ((p: ITerrainMaterialTilePayload) => void) | undefined;
    const stream = new TerrainMaterialTileStream({ capacity: 4,
      request: a => { requests.push(materialTileAddressKey(a));
        return a.x === 1 ? new Promise(resolve => finish = resolve) : Promise.resolve(payload(a)); },
      publish: () => undefined });
    stream.update([root, child]);
    await settle();
    for (let i = 0; i < 20; i++) stream.update([root, child]);
    await settle();
    expect(requests).toEqual(['0/0/0', '1/0/0']);
    stream.update([root, child, other]);
    await settle();
    expect(stream.resident.has('1/0/0')).toBeTrue();
    expect(stream.inFlight).toBe(1);
    finish!(payload(other));
    await settle();
    expect(stream.completed).toBe(3);
    stream.dispose();
  });

  it('discards stale worlds and offscreen in-flight results', async () => {
    const completions: ((p: ITerrainMaterialTilePayload) => void)[] = [];
    const publish = jasmine.createSpy('publish');
    const stream = new TerrainMaterialTileStream({ capacity: 4,
      request: () => new Promise(resolve => completions.push(resolve)), publish });
    stream.update([root]);
    await settle();
    stream.invalidate();
    stream.update([root]);
    completions[0](payload(root));
    await settle();
    expect(publish).not.toHaveBeenCalled();
    expect(completions.length).toBe(2);
    completions[1](payload(root));
    await settle();
    stream.update([root, child]);
    await settle();
    stream.update([root]);
    completions[2](payload(child));
    await settle();
    expect(stream.discarded).toBe(2);
    expect(stream.resident.size).toBe(1);
    stream.dispose();
  });

  it('evicts unused pages without evicting the pinned root or exceeding capacity', async () => {
    const stream = new TerrainMaterialTileStream({ capacity: 3,
      request: a => Promise.resolve(payload(a)), publish: () => undefined });
    for (let x = 0; x < 16; x++) {
      stream.update([root, { level: 4, x, y: 0 }]);
      await settle();
      expect(stream.resident.size).toBeLessThanOrEqual(3);
      expect(stream.resident.has('0/0/0')).toBeTrue();
      expect(new Set([...stream.resident.values()].map(p => p.slot)).size).toBe(stream.resident.size);
    }
    expect(stream.resident.has('4/0/0')).toBeFalse();
    stream.dispose();
  });

  it('surfaces a provider error once, without a retry storm', async () => {
    const request = jasmine.createSpy('request').and.callFake(() => Promise.reject(new Error('worker failed')));
    const stream = new TerrainMaterialTileStream({ capacity: 4, request, publish: () => undefined });
    stream.update([root]);
    await settle();
    stream.update([root]);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(stream.lastError).toContain('worker failed');
    stream.dispose();
  });

  it('does not lose the old resident page if publication fails', async () => {
    const stream = new TerrainMaterialTileStream({ capacity: 3,
      request: a => Promise.resolve(payload(a)),
      publish: p => { if (p.identity.address.x === 3) throw new Error('upload rejected'); } });
    for (const x of [0, 1, 2, 3]) {
      stream.update([root, { level: 2, x, y: 0 }]);
      await settle();
    }
    expect(stream.resident.size).toBe(3);
    expect(stream.resident.has('2/1/0')).toBeTrue();
    expect(stream.resident.has('2/3/0')).toBeFalse();
    expect(stream.lastError).toContain('upload rejected');
    stream.dispose();
  });

  it('refines independently, rejects hidden children and bounds desired ancestors', () => {
    const far = selectTerrainMaterialTiles({ targetTilePixels: 128, measure: () => 100 });
    const near = selectTerrainMaterialTiles({ targetTilePixels: 128,
      measure: a => a.x === 0 && a.y === 0 ? 2000 / 2 ** a.level : 0 });
    expect(far.addresses.length).toBe(1);
    expect(near.addresses.length).toBeGreaterThan(1);
    expect(near.addresses.every(a => a.x === 0 && a.y === 0)).toBeTrue();
    const bounded = selectTerrainMaterialTiles({ targetTilePixels: 128, maxTiles: 32, measure: () => 10000 });
    expect(bounded.addresses.length).toBeLessThanOrEqual(32);
    const keys = new Set(bounded.addresses.map(materialTileAddressKey));
    for (const a of bounded.addresses.filter(a => a.level > 0)) {
      expect(keys.has(`${a.level - 1}/${a.x >> 1}/${a.y >> 1}`)).toBeTrue();
    }
  });

  it('uses hysteresis near a refinement threshold', () => {
    const first = selectTerrainMaterialTiles({ targetTilePixels: 128, measure: a => a.level === 0 ? 130 : 0 });
    const previous = new Set(['0/0/0']);
    const retained = selectTerrainMaterialTiles({ targetTilePixels: 128, previousRefined: previous,
      measure: a => a.level === 0 ? 110 : 10 });
    const fresh = selectTerrainMaterialTiles({ targetTilePixels: 128,
      measure: a => a.level === 0 ? 110 : 10 });
    expect(first.addresses.length).toBe(1);
    expect(retained.addresses.length).toBe(5);
    expect(fresh.addresses.length).toBe(1);
  });
});
