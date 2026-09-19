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
    // cellDetailAmplitude: 0 keeps this assertion exact; the noise layer itself is covered below.
    const cellSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      features,
      featureComposition: 'cell',
      cellDetailAmplitude: 0,
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

  it('discrete cell mode anchors base elevation to the site cell with no neighbour blend, plus bounded local detail', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const site = graph.cells[0]!;
    const nearCornerDirection = normalize({
      x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
      y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
      z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
    });

    const blendedSampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const flatCellSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      featureComposition: 'cell',
      cellDetailAmplitude: 0,
    });
    const detailedCellSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      featureComposition: 'cell',
    });

    // Near a corner, 'shaped' blends toward the neighbours' corner-averaged elevation while
    // 'cell' stays flat at the site's own value — the "hard edge" the Civ-like mode is for.
    const blendedNearCorner = blendedSampler.sample(nearCornerDirection).baseElevation;
    const flatNearCorner = flatCellSampler.sample(nearCornerDirection).baseElevation;
    expect(flatNearCorner).toBeCloseTo(tectonics.elevation[site.id]!, 10);
    expect(blendedNearCorner).not.toBeCloseTo(flatNearCorner, 5);

    // The detail layer adds bounded, non-constant roughness on top of that flat anchor.
    const detailedCentre = detailedCellSampler.sample(site.center).baseElevation;
    const detailedNearCorner = detailedCellSampler.sample(nearCornerDirection).baseElevation;
    expect(detailedCentre).not.toBeCloseTo(detailedNearCorner, 5);
    expect(Math.abs(detailedCentre - tectonics.elevation[site.id]!)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(detailedNearCorner - tectonics.elevation[site.id]!)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('keeps ridge and river shaping identical between shaped and discrete cell modes', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const ecology = buildPlanetEcology(graph, tectonics, {
      riverDetail: { levels: 0 },
      ridges: { ridgeDetail: { stationCount: 2 } },
    });
    const shapedSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      ridgeWidthRadians: 0.2,
      riverWidthRadians: 0.2,
    });
    const cellSampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      ridgeWidthRadians: 0.2,
      riverWidthRadians: 0.2,
      featureComposition: 'cell',
    });

    const ridgePoint = ecology.ridgePaths[0]?.[0] ?? ecology.ridgePeaks[0];
    expect(ridgePoint).toBeDefined();
    if (ridgePoint) {
      expect(cellSampler.sample(ridgePoint).ridgeRelief).toBeCloseTo(
        shapedSampler.sample(ridgePoint).ridgeRelief,
        10,
      );
    }

    const riverPoint = ecology.riverPaths[0]?.[0];
    expect(riverPoint).toBeDefined();
    if (riverPoint) {
      expect(cellSampler.sample(riverPoint).riverCarve).toBeCloseTo(
        shapedSampler.sample(riverPoint).riverCarve,
        10,
      );
    }
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
