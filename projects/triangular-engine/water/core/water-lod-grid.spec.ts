import { computeWaterLodLevels, type WaterLodLevel } from './water-lod-grid';

const BASE_OPTIONS = {
  baseCellSize: 4,
  patchResolution: 8,
  coreSizePatches: 8,
  ringCount: 4,
};

/** True if world point (x, z) falls inside at least one patch footprint in this level. */
function levelCovers(level: WaterLodLevel, x: number, z: number): boolean {
  const half = level.patchWorldSize / 2;
  return level.instances.some(
    (instance) =>
      Math.abs(x - instance.x) <= half && Math.abs(z - instance.z) <= half,
  );
}

describe('computeWaterLodLevels', () => {
  it('rejects invalid options', () => {
    expect(() =>
      computeWaterLodLevels(0, 0, { ...BASE_OPTIONS, baseCellSize: 0 }),
    ).toThrowError();
    expect(() =>
      computeWaterLodLevels(0, 0, { ...BASE_OPTIONS, patchResolution: 0 }),
    ).toThrowError();
    expect(() =>
      computeWaterLodLevels(0, 0, { ...BASE_OPTIONS, coreSizePatches: 6 }),
    ).toThrowError();
    expect(() =>
      computeWaterLodLevels(0, 0, { ...BASE_OPTIONS, ringCount: -1 }),
    ).toThrowError();
  });

  it('doubles patch world size and produces one level per ring plus the core', () => {
    const levels = computeWaterLodLevels(0, 0, BASE_OPTIONS);
    expect(levels.length).toBe(BASE_OPTIONS.ringCount + 1);
    levels.forEach((level, i) => {
      expect(level.level).toBe(i);
      expect(level.patchWorldSize).toBeCloseTo(
        BASE_OPTIONS.baseCellSize * 2 ** i,
        10,
      );
    });
  });

  it('level 0 is a solid coreSizePatches x coreSizePatches block', () => {
    const [core] = computeWaterLodLevels(0, 0, BASE_OPTIONS);
    expect(core.instances.length).toBe(
      BASE_OPTIONS.coreSizePatches * BASE_OPTIONS.coreSizePatches,
    );
  });

  it('ring levels are hollow (fewer instances than a solid block)', () => {
    const levels = computeWaterLodLevels(0, 0, BASE_OPTIONS);
    const solidCount = BASE_OPTIONS.coreSizePatches * BASE_OPTIONS.coreSizePatches;
    for (const level of levels.slice(1)) {
      expect(level.instances.length).toBeGreaterThan(0);
      expect(level.instances.length).toBeLessThan(solidCount);
    }
  });

  it('has no gaps in coverage across the combined footprint, at the camera and off-centre', () => {
    for (const [cameraX, cameraZ] of [
      [0, 0],
      [17, -9],
      [-133, 40],
    ] as const) {
      const levels = computeWaterLodLevels(cameraX, cameraZ, BASE_OPTIONS);
      const outer = levels[levels.length - 1];
      const outerHalfExtent =
        (BASE_OPTIONS.coreSizePatches / 2) * outer.patchWorldSize;
      // Sample a grid of points well inside the outer level's extent (staying
      // clear of its own outer edge, which is only bounded by ringCount, not
      // by this test) and confirm every point is covered by some level.
      const margin = outer.patchWorldSize;
      const span = outerHalfExtent - margin;
      for (let dx = -span; dx <= span; dx += span / 3) {
        for (let dz = -span; dz <= span; dz += span / 3) {
          const x = cameraX + dx;
          const z = cameraZ + dz;
          const covered = levels.some((level) => levelCovers(level, x, z));
          expect(covered).toBe(true);
        }
      }
    }
  });
});
