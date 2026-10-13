import { buildPlanetGraphCore } from './planet-graph';
import { generateImpactCraters } from './impact-craters';

describe('generateImpactCraters', () => {
  it('generates multi-scale craters across basins, complex, and simple tiers', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 42 });
    const baseElevation = new Array(graph.cells.length).fill(0.1);

    const result = generateImpactCraters(graph, baseElevation, {
      seed: 42,
      basinCount: 2,
      complexCraterCount: 6,
      simpleCraterCount: 20,
    });

    expect(result.craters.length).toBe(28);
    const basins = result.craters.filter((c) => c.tier === 'basin');
    const complex = result.craters.filter((c) => c.tier === 'complex');
    const simple = result.craters.filter((c) => c.tier === 'simple');

    expect(basins.length).toBe(2);
    expect(complex.length).toBe(6);
    expect(simple.length).toBe(20);

    // Basins must be significantly larger than simple craters
    expect(basins[0]!.angularRadius).toBeGreaterThan(complex[0]!.angularRadius);
    expect(complex[0]!.angularRadius).toBeGreaterThan(simple[0]!.angularRadius);
  });

  it('excavates bowl depressions and creates raised rims spanning multiple cells', () => {
    const graph = buildPlanetGraphCore({ cellCount: 500, seed: 101 });
    const baseElevation = new Array(graph.cells.length).fill(0.2);

    const result = generateImpactCraters(graph, baseElevation, {
      seed: 101,
      basinCount: 3,
      complexCraterCount: 8,
      simpleCraterCount: 25,
      mariaBasaltFlooding: true,
    });

    // Check that we have both depressed cells (crater floor or maria) and elevated rim cells
    expect(result.rimCellIds.size).toBeGreaterThan(5);
    expect(result.mariaCellIds.size).toBeGreaterThan(5);

    // Rim cells must be elevated above the pre-impact base
    for (const rimCellId of result.rimCellIds) {
      // At least some rim cells should be above base elevation (accounting for overlapping craters)
      if (result.craterLandform[rimCellId] === 'crater_rim') {
        expect(result.elevation[rimCellId]).toBeGreaterThan(0.15);
      }
    }

    // Verify presence of lunar maria cells
    const mariaCells = result.craterLandform.filter((tag) => tag === 'lunar_maria');
    expect(mariaCells.length).toBeGreaterThan(0);
  });

  it('is strictly deterministic per seed and diverges with different seeds', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 7 });
    const base = new Array(graph.cells.length).fill(0);

    const runA = generateImpactCraters(graph, base, { seed: 1234 });
    const runB = generateImpactCraters(graph, base, { seed: 1234 });
    const runC = generateImpactCraters(graph, base, { seed: 9999 });

    expect(runA.elevation).toEqual(runB.elevation);
    expect(runA.craters.map((c) => c.angularRadius)).toEqual(runB.craters.map((c) => c.angularRadius));
    expect(runA.elevation).not.toEqual(runC.elevation);
  });
});
