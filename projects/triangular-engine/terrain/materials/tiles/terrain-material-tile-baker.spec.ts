import { bakeTerrainMaterialTile } from './terrain-material-tile-baker';

describe('terrain material tile baker', () => {
  it('samples outside the interior to build a usable gutter', () => {
    const payload = bakeTerrainMaterialTile(
      {
        worldRevision: 'world',
        address: { level: 2, x: 4, y: 7 },
        styleRevision: 'style',
        samplingVersion: 1,
        format: 'rgba8-linear',
      },
      {
        sample: (u, v) => [u, v, 0.5],
      },
      { interiorSize: 4, gutterSize: 1, mipLevels: 2 },
    );

    expect(payload.width).toBe(6);
    expect(payload.height).toBe(6);
    expect(payload.mipData.length).toBe(3);
    expect(payload.mipData[0]!.length).toBe(6 * 6 * 4);
    expect(payload.mipData[1]!.length).toBe(3 * 3 * 4);
    expect(payload.mipData[2]!.length).toBe(1 * 1 * 4);
    expect(payload.byteLength).toBe(6 * 6 * 4 + 3 * 3 * 4 + 4);

    // Bottom-left gutter uses the negative local coordinates, proving it was
    // sampled rather than filled by copying a single edge after the fact.
    expect(payload.mipData[0]![0]).toBe(0);
    expect(payload.mipData[0]![1]).toBe(0);
  });

  it('rejects invalid tile options', () => {
    expect(() =>
      bakeTerrainMaterialTile(
        {
          worldRevision: 'world',
          address: { level: 0, x: 0, y: 0 },
          styleRevision: 'style',
          samplingVersion: 1,
          format: 'rgba8-linear',
        },
        { sample: () => [1, 0, 0] },
        { interiorSize: 1, gutterSize: 1 },
      ),
    ).toThrowError(RangeError);
  });
});
