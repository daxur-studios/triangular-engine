import { createSyntheticNavigationFixture } from './navigation-fixtures';

describe('createSyntheticNavigationFixture', () => {
  it('creates stable tile IDs and bounds from its dimensions', () => {
    const fixture = createSyntheticNavigationFixture({ tileSize: 5, tilesAcross: 2, tilesDown: 1 });

    expect(fixture.upsertedTiles).toEqual([
      jasmine.objectContaining({ id: 'tile:0:0', bounds: { minimum: { x: 0, y: 0, z: 0 }, maximum: { x: 5, y: 0, z: 5 } } }),
      jasmine.objectContaining({ id: 'tile:1:0', bounds: { minimum: { x: 5, y: 0, z: 0 }, maximum: { x: 10, y: 0, z: 5 } } }),
    ]);
    expect(fixture.upsertedEdges).toEqual([
      jasmine.objectContaining({ id: 'edge:0:0:1:0:forward', fromRegionId: 'region:0:0', toRegionId: 'region:1:0' }),
      jasmine.objectContaining({ id: 'edge:0:0:1:0:reverse', fromRegionId: 'region:1:0', toRegionId: 'region:0:0' }),
    ]);
  });
});
