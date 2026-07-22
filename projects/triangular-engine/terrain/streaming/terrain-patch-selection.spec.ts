import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
import { selectAdaptiveTerrainPatches } from './terrain-patch-selection';

describe('adaptive terrain patch selection', () => {
  const domain = new PlaneTerrainDomain(1_024);

  it('refines near the camera while retaining distant parent coverage', () => {
    const roots = [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 1, z: 0 },
    ];
    const selected = selectAdaptiveTerrainPatches(domain, {
      roots,
      cameraWorldM: [128, 0, -128],
      getLevel: (address) => address.level,
      maxLevel: 2,
      refinementDistanceM: 900,
    });

    expect(selected.some(({ level }) => level === 2)).toBeTrue();
    expect(selected).toContain({ level: 0, x: 1, z: 0 });
  });

  it('returns roots unchanged when the camera is outside refinement range', () => {
    const root = { level: 0, x: 0, z: 0 };
    expect(
      selectAdaptiveTerrainPatches(domain, {
        roots: [root],
        cameraWorldM: [10_000, 0, 10_000],
        getLevel: (address) => address.level,
        maxLevel: 3,
        refinementDistanceM: 1_000,
      }),
    ).toEqual([root]);
  });
});
