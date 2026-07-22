import {
  computeWaterLodBoundaryRadius,
  computeWaterLodLevels,
  type WaterLodLevel,
} from './water-lod-grid';

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

describe('computeWaterLodBoundaryRadius', () => {
  it('rejects level < 1', () => {
    expect(() => computeWaterLodBoundaryRadius(0, BASE_OPTIONS)).toThrowError();
    expect(() => computeWaterLodBoundaryRadius(-1, BASE_OPTIONS)).toThrowError();
  });

  it('doubles with each level, matching patchWorldSize growth', () => {
    const r1 = computeWaterLodBoundaryRadius(1, BASE_OPTIONS);
    const r2 = computeWaterLodBoundaryRadius(2, BASE_OPTIONS);
    const r3 = computeWaterLodBoundaryRadius(3, BASE_OPTIONS);
    expect(r2).toBeCloseTo(r1 * 2, 10);
    expect(r3).toBeCloseTo(r2 * 2, 10);
  });

  it('sits strictly between the finer level\'s true edge and its own hole edge, with margin on both sides', () => {
    for (let level = 1; level <= BASE_OPTIONS.ringCount; level++) {
      const levels = computeWaterLodLevels(0, 0, BASE_OPTIONS);
      const finer = levels[level - 1];
      const coarser = levels[level];
      const halfCountPatches = BASE_OPTIONS.coreSizePatches / 2;
      const innerHalf = halfCountPatches / 2 - 1;

      const finerTrueEdge = halfCountPatches * finer.patchWorldSize;
      const coarserHoleEdge = innerHalf * coarser.patchWorldSize;

      const boundary = computeWaterLodBoundaryRadius(level, BASE_OPTIONS);

      // The boundary must fall inside the finer level's own footprint (it
      // has to actually have geometry there to hand off from) and outside
      // the coarser level's hole (same reasoning, other direction).
      expect(boundary).toBeLessThan(finerTrueEdge);
      expect(boundary).toBeGreaterThan(coarserHoleEdge);
    }
  });
});
