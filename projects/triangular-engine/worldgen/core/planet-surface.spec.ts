import { buildPlanetEcology } from './ecology';
import { buildPlanetGraphCore } from './planet-graph';
import { createPlanetSurfaceSampler } from './planet-surface';
import { buildPlanetTectonics } from './tectonics';
import { normalize } from './vec3';

describe('createPlanetSurfaceSampler', () => {
  it('keeps coherent sampleNear results equivalent to the canonical sampler', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 19 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 19 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      featureComposition: 'cell',
    });
    const direction = normalize({ x: 0.23, y: 0.71, z: -0.41 });
    const cell = graph.cells[0]!;
    const canonical = sampler.sample(direction);
    const coherent = sampler.sampleNear?.(direction, cell.id);
    expect(coherent).toBeDefined();
    expect(coherent!.elevation).toBeCloseTo(canonical.elevation, 8);
    expect(coherent!.riverCarve).toBeCloseTo(canonical.riverCarve, 8);
  });

  it('applies a volcano shape inside its owning cell and fades before the cell edge', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const site = graph.cells.find((cell) => tectonics.isLand[cell.id]) ?? graph.cells[0]!;
    const features = {
      feature: graph.cells.map((cell) => (cell.id === site.id ? 'volcano' : 'none')) as Array<'none' | 'volcano'>,
      instances: [{ kind: 'volcano' as const, siteCellId: site.id, elevationDelta: 0.7 }],
      featureByCellId: new Map([[site.id, { kind: 'volcano' as const, siteCellId: site.id, elevationDelta: 0.7 }]]),
    };
    const baselineSampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, { features });
    // Forcing 'meadow' (the flat landform tier, no dome exaggeration) plus cellDetailAmplitude: 0
    // isolates the feature stamp from the landform shaping/noise covered by the tests below, so
    // this assertion stays exact regardless of which tier the generated site actually landed on.
    const flatEcology = { ...ecology, biome: ecology.biome.map(() => 'meadow' as const) };
    const cellSampler = createPlanetSurfaceSampler(graph, tectonics, flatEcology, {
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
    const cellCentre = cellSampler.sample(site.center);
    const cellNearCorner = cellSampler.sample(
      normalize({
        x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
        y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
        z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
      }),
    );
    expect(cellCentre.elevation).toBeGreaterThan(baselineCentre.elevation);
    expect(cellCentre.elevation - baselineCentre.elevation).toBeGreaterThan(
      cellNearCorner.elevation - baselineNearCorner.elevation,
    );
  });

  it('discrete cell mode keeps a local anchor while joining the shared ground at cell edges', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const site = graph.cells[0]!;
    const nearCornerDirection = normalize({
      x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
      y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
      z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
    });
    // Force the flat landform tier so this test isolates blending from landform shaping.
    const flatEcology = { ...ecology, biome: ecology.biome.map(() => 'meadow' as const) };

    const blendedSampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const noBlendSampler = createPlanetSurfaceSampler(graph, tectonics, flatEcology, {
      featureComposition: 'cell',
      cellBlendFraction: 0,
      cellDetailAmplitude: 0,
    });
    const partialBlendSampler = createPlanetSurfaceSampler(graph, tectonics, flatEcology, {
      featureComposition: 'cell',
      cellDetailAmplitude: 0,
    });

    const blendedNearCorner = blendedSampler.sample(nearCornerDirection).baseElevation;
    const noBlendNearCorner = noBlendSampler.sample(nearCornerDirection).baseElevation;
    const partialNearCorner = partialBlendSampler.sample(nearCornerDirection).baseElevation;

    // The edge transition applies even when the centre blend is zero: the cell must not remain a
    // raised platform at its Voronoi boundary.
    expect(noBlendNearCorner).not.toBeCloseTo(tectonics.elevation[site.id]!, 5);
    // The configured centre blend still changes the local result, while both samples remain
    // between the cell's own value and the shared shaped surface.
    expect(partialNearCorner).not.toBeCloseTo(noBlendNearCorner, 5);
    expect(partialNearCorner).not.toBeCloseTo(blendedNearCorner, 5);
    const [lo, hi] =
      noBlendNearCorner < blendedNearCorner
        ? [noBlendNearCorner, blendedNearCorner]
        : [blendedNearCorner, noBlendNearCorner];
    expect(partialNearCorner).toBeGreaterThan(lo);
    expect(partialNearCorner).toBeLessThan(hi);
  });

  it('shapes a mountain-tier cell with a peak at its centre that falls off toward its edge', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    // Use the planet's actual highest cell so it is meaningfully above sea level — the dome only
    // exaggerates height above the sea datum (see planet-surface.ts), so forcing 'alpine' onto an
    // arbitrary (possibly oceanic) cell wouldn't exercise the peak shape at all.
    const highestElevation = Math.max(...tectonics.elevation);
    const site = graph.cells[tectonics.elevation.indexOf(highestElevation)]!;
    const nearCornerDirection = normalize({
      x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
      y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
      z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
    });
    const mountainEcology = { ...ecology, biome: ecology.biome.map(() => 'alpine' as const) };

    // cellDetailAmplitude: 0 isolates the local landform shape from the texture noise layer.
    const sampler = createPlanetSurfaceSampler(graph, tectonics, mountainEcology, {
      featureComposition: 'cell',
      cellDetailAmplitude: 0,
    });

    const ownElevation = tectonics.elevation[site.id]!;
    const centre = sampler.sample(site.center).baseElevation;
    const nearCorner = sampler.sample(nearCornerDirection).baseElevation;

    // A mountain cell gets local relief at the centre and falls toward the shared ground near its
    // edge, rather than holding one raised elevation across the entire polygon.
    expect(centre).toBeGreaterThan(ownElevation);
    expect(centre).toBeGreaterThan(nearCorner);
  });

  it('keeps a flat-tier cell free of added macro relief, with non-constant local detail', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 71 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 71 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const site = graph.cells[0]!;
    const nearCornerDirection = normalize({
      x: site.center.x * 0.8 + site.corners[0]!.x * 0.2,
      y: site.center.y * 0.8 + site.corners[0]!.y * 0.2,
      z: site.center.z * 0.8 + site.corners[0]!.z * 0.2,
    });
    const flatEcology = { ...ecology, biome: ecology.biome.map(() => 'meadow' as const) };

    // Zero centre blend isolates the continuous edge transition from the local detail noise.
    const sampler = createPlanetSurfaceSampler(graph, tectonics, flatEcology, {
      featureComposition: 'cell',
      cellBlendFraction: 0,
    });

    const ownElevation = tectonics.elevation[site.id]!;
    const centre = sampler.sample(site.center).baseElevation;
    const nearCorner = sampler.sample(nearCornerDirection).baseElevation;
    const blendedNearCorner = createPlanetSurfaceSampler(graph, tectonics, flatEcology).sample(
      nearCornerDirection,
    ).baseElevation;

    expect(centre).not.toBeCloseTo(nearCorner, 5);
    expect(Math.abs(centre - ownElevation)).toBeLessThanOrEqual(0.015 + 1e-9);
    expect(Math.abs(nearCorner - ownElevation)).toBeLessThanOrEqual(
      Math.abs(blendedNearCorner - ownElevation) + 0.015 + 1e-9,
    );
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

  it('keeps sampled land and water ownership aligned with the generated cell mask', () => {
    const graph = buildPlanetGraphCore({ cellCount: 240, seed: 81 });
    const generated = buildPlanetTectonics(graph, { plateCount: 9, seed: 81 });
    const ecology = buildPlanetEcology(graph, generated);
    const landCellId = generated.isLand.findIndex(Boolean);
    const waterCellId = generated.isLand.findIndex((isLand) => !isLand);
    expect(landCellId).toBeGreaterThanOrEqual(0);
    expect(waterCellId).toBeGreaterThanOrEqual(0);

    // Deliberately make the elevation contour disagree with each cell's final
    // ownership. Surface sampling must retain the discrete mask as authority.
    const elevation = generated.elevation.slice();
    elevation[landCellId] = generated.seaLevelElevation - 1;
    elevation[waterCellId] = generated.seaLevelElevation + 1;
    const tectonics = { ...generated, elevation };
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      featureComposition: 'cell',
      cellDetailAmplitude: 0,
    });

    const landSample = sampler.sample(graph.cells[landCellId]!.center);
    const waterSample = sampler.sample(graph.cells[waterCellId]!.center);
    expect(landSample.isLand).toBe(true);
    expect(landSample.elevation).toBeGreaterThanOrEqual(landSample.seaLevel);
    expect(waterSample.isLand).toBe(false);
    expect(waterSample.elevation).toBeLessThanOrEqual(waterSample.seaLevel);
  });

  it('elevates polar ice / sea ice cells above sea level with freeboard', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const baseEcology = buildPlanetEcology(graph, tectonics);

    // Find an oceanic water cell
    const waterCellId = tectonics.isLand.findIndex((isLand) => !isLand);
    expect(waterCellId).toBeGreaterThanOrEqual(0);

    const waterCell = graph.cells[waterCellId]!;
    // Set this cell to 'ice_cap'
    const biomes = [...baseEcology.biome];
    biomes[waterCellId] = 'ice_cap';
    const iceEcology = { ...baseEcology, biome: biomes };

    const sampler = createPlanetSurfaceSampler(graph, tectonics, iceEcology);
    const sample = sampler.sample(waterCell.center);

    expect(sample.isIce).toBe(true);
    expect(sample.isLand).toBe(false);
    expect(sample.elevation).toBeGreaterThan(sample.seaLevel);
    expect(sample.elevation - sample.seaLevel).toBeCloseTo(0.02, 2);
  });

  it('respects custom iceShelfFreeboard parameter', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const baseEcology = buildPlanetEcology(graph, tectonics);

    const waterCellId = tectonics.isLand.findIndex((isLand) => !isLand);
    const waterCell = graph.cells[waterCellId]!;
    const biomes = [...baseEcology.biome];
    biomes[waterCellId] = 'ice_cap';
    const iceEcology = { ...baseEcology, biome: biomes };

    const customSampler = createPlanetSurfaceSampler(graph, tectonics, iceEcology, {
      iceShelfFreeboard: 0.06,
    });
    const sample = customSampler.sample(waterCell.center);

    expect(sample.isIce).toBe(true);
    expect(sample.elevation - sample.seaLevel).toBeCloseTo(0.06, 2);
  });
});
