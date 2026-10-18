import { buildCellPlanetWorld } from './cell-planet-world';
import { createPlanetSurfaceSampler } from './planet-surface';
import {
  illustrativePeak,
  illustrativeTerrainKey,
  resolveIllustrativeTerrain,
} from './illustrative-terrain';
import { normalize } from './vec3';

describe('illustrative terrain', () => {
  const config = { version: 1, kind: 'illustrative' } as const;
  const world = buildCellPlanetWorld({
    cellCount: 180,
    seed: 71,
    worldProfileKind: 'terran',
  });
  const flatEcology = {
    ...world.ecology,
    biome: world.ecology.biome.map(() => 'meadow' as const),
    ridgePaths: [],
    ridgePeaks: [],
    riverPaths: [],
  };
  const illustrated = createPlanetSurfaceSampler(
    world.graph,
    world.tectonics,
    flatEcology,
    { illustrativeTerrain: config },
  );
  const baseline = createPlanetSurfaceSampler(
    world.graph,
    world.tectonics,
    flatEcology,
  );

  it('compresses only land ground, leaving ocean bathymetry and ownership intact', () => {
    let land = 0;
    let ocean = 0;
    for (const cell of world.graph.cells) {
      const before = baseline.sample(cell.center);
      const after = illustrated.sample(cell.center);
      expect(after.isLand).toBe(before.isLand);
      expect(after.seaLevel).toBe(before.seaLevel);
      if (before.isLand && before.elevation > before.seaLevel) {
        land++;
        expect(after.elevation - after.seaLevel).toBeCloseTo(
          (before.elevation - before.seaLevel) * 0.12,
          9,
        );
      } else if (!before.isLand) {
        ocean++;
        expect(after.elevation).toBeCloseTo(before.elevation, 9);
      }
    }
    expect(land).toBeGreaterThan(0);
    expect(ocean).toBeGreaterThan(0);
  });

  it('meets continuously at land/coast edges (floating ice is a separate surface)', () => {
    const sampler = createPlanetSurfaceSampler(
      world.graph,
      world.tectonics,
      world.ecology,
      { features: world.features, illustrativeTerrain: config },
    );
    let checked = 0;
    for (const cell of world.graph.cells.slice(0, 50)) {
      for (let i = 0; i < cell.corners.length; i++) {
        const a = cell.corners[i];
        const b = cell.corners[(i + 1) % cell.corners.length];
        const edge = normalize({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
        const inward = normalize({
          x: edge.x + cell.center.x * 1e-8,
          y: edge.y + cell.center.y * 1e-8,
          z: edge.z + cell.center.z * 1e-8,
        });
        const outward = normalize({
          x: edge.x - cell.center.x * 1e-8,
          y: edge.y - cell.center.y * 1e-8,
          z: edge.z - cell.center.z * 1e-8,
        });
        const before = sampler.sample(inward),
          after = sampler.sample(outward);
        if (before.isIce || after.isIce) continue;
        checked++;
        expect(Math.abs(before.elevation - after.elevation)).toBeLessThan(1e-5);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('keeps coherent sampling equal at poles, seam and cell centres', () => {
    const sampler = createPlanetSurfaceSampler(
      world.graph,
      world.tectonics,
      world.ecology,
      { features: world.features, illustrativeTerrain: config },
    );
    for (const point of [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: -1 },
      ...world.graph.cells.map((c) => c.center),
    ]) {
      expect(sampler.sampleNear!(point, 0)).toEqual(sampler.sample(point));
    }
  });

  it('has linear mountain flanks and a crater below its rim', () => {
    expect(illustrativePeak(0, 0)).toBe(1);
    expect(illustrativePeak(0.25, 0)).toBeCloseTo(0.75, 10);
    expect(illustrativePeak(0.5, 0)).toBeCloseTo(0.5, 10);
    expect(illustrativePeak(1, 0)).toBe(0);
    expect(illustrativePeak(0, 0, true)).toBeLessThan(
      illustrativePeak(0.22, 0, true),
    );
    expect(illustrativePeak(1, 0, true)).toBe(0);
  });

  it('preserves independently controlled volcano height when lowland relief changes', () => {
    const site = world.graph.cells
      .filter((c) => world.tectonics.isLand[c.id])
      .sort(
        (a, b) =>
          world.tectonics.elevation[b.id] - world.tectonics.elevation[a.id],
      )[0];
    const instance = {
      kind: 'volcano' as const,
      siteCellId: site.id,
      elevationDelta: 0.7,
    };
    const features = {
      instances: [instance],
      featureByCellId: new Map([[site.id, instance]]),
      feature: world.features.feature,
    };
    const reliefs = [0.01, 0.8].map((lowlandReliefScale) => {
      const sampler = createPlanetSurfaceSampler(
        world.graph,
        world.tectonics,
        flatEcology,
        {
          features,
          illustrativeTerrain: {
            ...config,
            lowlandReliefScale,
            volcanoRelief: 0.6,
          },
        },
      );
      const sample = sampler.sample(site.center);
      return sample.elevation - sample.baseElevation;
    });
    expect(reliefs[0]).toBeCloseTo(0.55 * 0.6, 8);
    expect(reliefs[1]).toBeCloseTo(reliefs[0], 8);
  });

  it('resolves stable serializable cache identity and rejects invalid configuration', () => {
    expect(illustrativeTerrainKey()).toBe('');
    expect(illustrativeTerrainKey(config)).toBe(
      illustrativeTerrainKey({ ...config, lowlandReliefScale: 0.12 }),
    );
    expect(illustrativeTerrainKey({ ...config, mountainRelief: 0.6 })).not.toBe(
      illustrativeTerrainKey(config),
    );
    expect(() =>
      resolveIllustrativeTerrain({ ...config, mountainRadiusFraction: 0 }),
    ).toThrowError(RangeError);
    expect(() =>
      resolveIllustrativeTerrain({ ...config, lowlandReliefScale: NaN }),
    ).toThrowError(RangeError);
    expect(() =>
      resolveIllustrativeTerrain({ ...config, version: 2 } as never),
    ).toThrowError(RangeError);
  });
});
