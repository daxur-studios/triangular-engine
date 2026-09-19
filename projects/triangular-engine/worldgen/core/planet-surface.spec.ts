import { buildPlanetEcology } from './ecology';
import { buildPlanetGraphCore } from './planet-graph';
import { createPlanetSurfaceSampler } from './planet-surface';
import { buildPlanetTectonics } from './tectonics';
import { normalize } from './vec3';

describe('createPlanetSurfaceSampler', () => {
  it('applies a volcano shape inside its owning cell and fades before the cell edge', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const site = graph.cells[0]!;
    const features = {
      feature: graph.cells.map((cell) => (cell.id === site.id ? 'volcano' : 'none')) as Array<'none' | 'volcano'>,
      instances: [{ kind: 'volcano' as const, siteCellId: site.id, elevationDelta: 0.7 }],
      featureByCellId: new Map([[site.id, { kind: 'volcano' as const, siteCellId: site.id, elevationDelta: 0.7 }]]),
    };
    const baselineSampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, { features });
    const cellSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      features,
      featureComposition: 'cell',
    });

    const centre = sampler.sample(site.center);
    const nearCorner = sampler.sample(
      normalize({
        x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
        y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
        z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
      }),
    );

    const baselineCentre = baselineSampler.sample(site.center);
    const baselineNearCorner = baselineSampler.sample(
      normalize({
        x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
        y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
        z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
      }),
    );
    expect(centre.elevation).toBeGreaterThan(baselineCentre.elevation);
    expect(nearCorner.elevation - baselineNearCorner.elevation).toBeLessThan(
      centre.elevation - baselineCentre.elevation,
    );
    expect(cellSampler.sample(site.center).elevation - baselineCentre.elevation).toBeCloseTo(0.7, 5);
  });

  it('is deterministic and projection-independent', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 61 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 61 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const direction = normalize({ x: 0.31, y: 0.72, z: -0.41 });

    const a = createPlanetSurfaceSampler(graph, tectonics, ecology).sample(direction);
    const b = createPlanetSurfaceSampler(graph, tectonics, ecology).sample({
      x: direction.x * 7,
      y: direction.y * 7,
      z: direction.z * 7,
    });

    expect(b).toEqual(a);
  });

  it('adds relief on a ridge and keeps river channels below the uncarved surface', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const ecology = buildPlanetEcology(graph, tectonics, {
      riverDetail: { levels: 0 },
      ridges: { ridgeDetail: { stationCount: 2 } },
    });
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      ridgeWidthRadians: 0.2,
      riverWidthRadians: 0.2,
    });

    const ridgePoint = ecology.ridgePaths[0]?.[0] ?? ecology.ridgePeaks[0];
    expect(ridgePoint).toBeDefined();
    if (ridgePoint) {
      const ridge = sampler.sample(ridgePoint);
      expect(ridge.ridgeRelief).toBeGreaterThan(0);
      expect(ridge.elevation).toBeGreaterThanOrEqual(ridge.baseElevation);
    }

    const riverPoint = ecology.riverPaths[0]?.[0];
    expect(riverPoint).toBeDefined();
    if (riverPoint) {
      const river = sampler.sample(riverPoint);
      if (river.isLand) expect(river.riverCarve).toBeGreaterThan(0);
      expect(river.elevation).toBeGreaterThanOrEqual(river.seaLevel);
    }
  });

  it('preserves below-sea terrain for bathymetry', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const waterCellId = tectonics.isLand.reduce((bestId, isLand, cellId) => {
      if (isLand) return bestId;
      return bestId < 0 || tectonics.elevation[cellId]! < tectonics.elevation[bestId]!
        ? cellId
        : bestId;
    }, -1);
    expect(waterCellId).toBeGreaterThanOrEqual(0);

    if (waterCellId >= 0) {
      const sample = createPlanetSurfaceSampler(graph, tectonics, ecology).sample(
        graph.cells[waterCellId]!.center,
      );
      expect(sample.isLand).toBe(false);
      expect(sample.elevation).toBeLessThan(sample.seaLevel);
    }
  });
});
