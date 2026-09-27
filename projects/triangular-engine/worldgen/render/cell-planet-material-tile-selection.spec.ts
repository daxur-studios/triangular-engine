import { PerspectiveCamera } from 'three';
import { LatLonTerrainDomain } from 'triangular-engine/terrain';
import { selectCellPlanetMaterialTiles } from './cell-planet-material-tile-selection';

describe('selectCellPlanetMaterialTiles', () => {
  it('refines visible texture pages within the bounded cut and preserves the root', () => {
    const camera = new PerspectiveCamera(60, 4 / 3, 1, 5_000);
    camera.position.set(0, 0, 1_100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const selection = selectCellPlanetMaterialTiles({
      domain: new LatLonTerrainDomain(1_000, 4, 2),
      radiusM: 1_000,
      camera,
      viewportWidthPixels: 800,
      viewportHeightPixels: 600,
      morphProgress: 0,
      projectionKind: 'equalEarth',
      heightScaleM: 20,
      targetTilePixels: 48,
      maxTiles: 12,
      maxLevel: 8,
    });

    expect(selection.addresses[0]).toEqual({ level: 0, x: 0, y: 0 });
    expect(selection.addresses.length).toBeGreaterThan(1);
    expect(selection.addresses.length).toBeLessThanOrEqual(12);
    expect(
      Math.max(...selection.addresses.map((address) => address.level)),
    ).toBeGreaterThan(0);
  });
});
