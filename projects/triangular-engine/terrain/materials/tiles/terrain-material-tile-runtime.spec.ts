import { TerrainMaterialTileRuntime } from './terrain-material-tile-runtime';
import type {
  ITerrainMaterialTileAddress,
  ITerrainMaterialTilePayload,
} from './terrain-material-tile';

describe('TerrainMaterialTileRuntime', () => {
  const root: ITerrainMaterialTileAddress = { level: 0, x: 0, y: 0 };

  function payload(
    address: ITerrainMaterialTileAddress,
  ): ITerrainMaterialTilePayload {
    const pixels = new Uint8Array(132 * 132 * 4);
    return {
      identity: {
        address,
        worldRevision: 'world-a',
        styleRevision: 'style-a',
        samplingVersion: 1,
        format: 'rgba8-linear',
      },
      interiorSize: 128,
      gutterSize: 2,
      width: 132,
      height: 132,
      mipData: [pixels],
      byteLength: pixels.byteLength,
    };
  }

  async function settle(): Promise<void> {
    for (let index = 0; index < 40; index++) await Promise.resolve();
  }

  it('owns selection, root fallback visibility, invalidation and disposal', async () => {
    let requests = 0;
    const runtime = new TerrainMaterialTileRuntime({
      request: (address) => {
        requests++;
        return Promise.resolve(payload(address));
      },
    });

    runtime.update([]);
    await settle();
    expect(requests).toBe(0);
    runtime.update([{ level: 1, x: 0, y: 0 }]);
    await settle();
    expect(runtime.stats.resident).toBe(2);
    expect(runtime.stats.completed).toBe(2);
    expect(runtime.gpu.enabled.value).toBe(1);

    runtime.setEnabled(false);
    expect(runtime.gpu.enabled.value).toBe(0);

    runtime.setEnabled(true);
    expect(runtime.gpu.enabled.value).toBe(1);
    runtime.invalidate();
    expect(runtime.stats.resident).toBe(0);
    expect(runtime.gpu.enabled.value).toBe(0);

    runtime.update([root]);
    await settle();
    expect(requests).toBe(3);
    expect(runtime.gpu.enabled.value).toBe(1);
    runtime.dispose();
    expect(runtime.gpu.enabled.value).toBe(0);
    runtime.update([root]);
    await settle();
    expect(requests).toBe(3);
  });
});
