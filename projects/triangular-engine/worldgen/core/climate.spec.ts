import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';

describe('computeClimate', () => {
  it('poles are colder than the equator at any seed', () => {
    for (const seed of [1, 7, 42]) {
      const graph = buildPlanetGraphCore({ cellCount: 200, seed });
      const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed });
      const climate = computeClimate(
        graph,
        tectonics.elevation,
        tectonics.isLand,
        tectonics.seaLevelElevation,
      );

      const poleCells = graph.cells.filter((cell) => Math.abs(cell.center.y) > 0.9);
      const equatorCells = graph.cells.filter((cell) => Math.abs(cell.center.y) < 0.1);
      expect(poleCells.length).toBeGreaterThan(0);
      expect(equatorCells.length).toBeGreaterThan(0);

      const avg = (cells: typeof poleCells) =>
        cells.reduce((sum, c) => sum + climate.temperature[c.id], 0) / cells.length;
      expect(avg(poleCells)).toBeLessThan(avg(equatorCells));
    }
  });

  it('ocean cells are the wettest, decaying inland', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 5 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 5 });
    const climate = computeClimate(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
    );

    for (let id = 0; id < graph.cells.length; id++) {
      if (!tectonics.isLand[id]) expect(climate.moisture[id]).toBe(1);
    }

    const coastalLandMoisture = graph.cells
      .filter((cell) => tectonics.isLand[cell.id] && cell.neighbors.some((n) => !tectonics.isLand[n]))
      .map((cell) => climate.moisture[cell.id]);
    const driestLand = Math.min(
      ...graph.cells.filter((cell) => tectonics.isLand[cell.id]).map((cell) => climate.moisture[cell.id]),
    );

    expect(coastalLandMoisture.length).toBeGreaterThan(0);
    expect(Math.max(...coastalLandMoisture)).toBeGreaterThan(driestLand);
  });

  it('is deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 9 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 9 });
    const a = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const b = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    expect(a).toEqual(b);
  });
});
