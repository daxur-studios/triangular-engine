import { PlaneTerrainDomain } from './plane-terrain-domain';
import {
  getPlaneTerrainPatchKey,
  selectPlaneTerrainPatches,
} from './plane-terrain-selection';

describe('plane terrain selection', () => {
  const domain = new PlaneTerrainDomain(512);

  it('selects a bounded square around the world-space camera position', () => {
    const addresses = selectPlaneTerrainPatches(domain, 700, 0, 1);

    expect(addresses).toHaveSize(9);
    expect(addresses).toContain({ level: 0, x: 0, z: -1 });
    expect(addresses).toContain({ level: 0, x: 2, z: 1 });
  });

  it('moves only after crossing a patch boundary, including negative Z', () => {
    const before = selectPlaneTerrainPatches(domain, 511.9, -511.9, 0)[0];
    const after = selectPlaneTerrainPatches(domain, 512, -512, 0)[0];

    expect(before).toEqual({ level: 0, x: 0, z: 0 });
    expect(after).toEqual({ level: 0, x: 1, z: 1 });
  });

  it('provides distinct stable keys across levels and signed addresses', () => {
    expect(getPlaneTerrainPatchKey({ level: 2, x: -3, z: 4 })).toBe('2:-3:4');
  });
});
