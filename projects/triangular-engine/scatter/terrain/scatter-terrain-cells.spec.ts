import {
  CylinderTerrainDomain,
  PlaneTerrainDomain,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type IPlaneTerrainPatchAddress,
} from 'triangular-engine/terrain';

import { selectFixedLevelScatterCells } from './scatter-terrain-cells';

describe('selectFixedLevelScatterCells', () => {
  it('selects the plane cell containing the anchor at level 0', () => {
    const domain = new PlaneTerrainDomain(100);
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -2; z <= 2; z++) {
      for (let x = -2; x <= 2; x++) roots.push({ level: 0, x, z });
    }
    const selected = selectFixedLevelScatterCells(domain, {
      roots,
      anchorWorldM: [250, 0, -250],
      radiusM: 10,
      fixedLevel: 0,
      getLevel: (a) => a.level,
    });
    expect(selected).toContain({ level: 0, x: 2, z: 2 });
    for (const address of selected) expect(address.level).toBe(0);
  });

  it('refines a plane root down to the fixed level, never returning coarser addresses', () => {
    const domain = new PlaneTerrainDomain(100);
    const selected = selectFixedLevelScatterCells(domain, {
      roots: [{ level: 0, x: 0, z: 0 }],
      anchorWorldM: [50, 0, -50],
      radiusM: 60,
      fixedLevel: 2,
      getLevel: (a) => a.level,
    });
    expect(selected.length).toBeGreaterThan(0);
    for (const address of selected) expect(address.level).toBe(2);
  });

  it('excludes cells far outside the anchor radius', () => {
    const domain = new PlaneTerrainDomain(100);
    const roots: IPlaneTerrainPatchAddress[] = [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 50, z: 50 },
    ];
    const selected = selectFixedLevelScatterCells(domain, {
      roots,
      anchorWorldM: [50, 0, -50],
      radiusM: 10,
      fixedLevel: 0,
      getLevel: (a) => a.level,
    });
    expect(selected).toEqual([{ level: 0, x: 0, z: 0 }]);
  });

  it('keeps sphere selection to the face containing the anchor when faces are far apart', () => {
    const domain = new SphereTerrainDomain(500);
    const roots = SPHERE_TERRAIN_FACES.map((face) => ({
      face,
      level: 0,
      x: 0,
      y: 0,
    }));
    const selected = selectFixedLevelScatterCells(domain, {
      roots,
      anchorWorldM: [500, 0, 0],
      radiusM: 150,
      fixedLevel: 1,
      getLevel: (a) => a.level,
    });
    expect(selected.length).toBeGreaterThan(0);
    for (const address of selected) {
      expect(address.level).toBe(1);
      expect(address.face).toBe('positive-x');
    }
  });

  it('selects fixed-level cylinder cells near the anchor', () => {
    const domain = new CylinderTerrainDomain({
      radiusM: 500,
      lengthM: 2_000,
      levelZeroAngularPatchCount: 8,
      levelZeroAxialPatchCount: 4,
    });
    const counts = domain.getPatchCounts(0);
    const roots = Array.from({ length: counts.axial }, (_, axialIndex) =>
      Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
        level: 0,
        angularIndex,
        axialIndex,
      })),
    ).flat();
    const anchorWorldM = domain.getSurfacePosition(
      { level: 0, angularIndex: 0, axialIndex: 0 },
      0,
      0,
      0,
    );
    const selected = selectFixedLevelScatterCells(domain, {
      roots,
      anchorWorldM,
      radiusM: 300,
      fixedLevel: 1,
      getLevel: (a) => a.level,
    });
    expect(selected.length).toBeGreaterThan(0);
    for (const address of selected) expect(address.level).toBe(1);
  });

  it('rejects invalid options', () => {
    const domain = new PlaneTerrainDomain(100);
    expect(() =>
      selectFixedLevelScatterCells(domain, {
        roots: [{ level: 0, x: 0, z: 0 }],
        anchorWorldM: [0, 0, 0],
        radiusM: -1,
        fixedLevel: 0,
        getLevel: (a) => a.level,
      }),
    ).toThrowError(RangeError);
  });
});
