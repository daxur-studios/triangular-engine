import { buildPlanetGraphCore } from './planet-graph';
import { computeLandmasses } from './landmasses';

describe('computeLandmasses', () => {
  it('returns deterministic connected land regions and water ids', () => {
    const graph = buildPlanetGraphCore({ cellCount: 80, seed: 12, relaxationIterations: 1 });
    const isLand = graph.cells.map((cell) => cell.id < 40);
    const result = computeLandmasses(graph, isLand);

    expect(result.landCellIds).toEqual(Array.from({ length: 40 }, (_, id) => id));
    expect(result.waterCellIds).toEqual(Array.from({ length: 40 }, (_, id) => id + 40));
    expect(result.landmassIdByCell.slice(40)).toEqual(new Array(40).fill(-1));
    expect(result.landmasses.every((landmass) => landmass.cellIds.length > 0)).toBeTrue();

    const repeat = computeLandmasses(graph, isLand);
    expect(repeat).toEqual(result);
  });

  it('marks cells touching water as coastal', () => {
    const graph = buildPlanetGraphCore({ cellCount: 40, seed: 19, relaxationIterations: 1 });
    const isLand = graph.cells.map((cell) => cell.id % 3 !== 0);
    const result = computeLandmasses(graph, isLand);

    for (const landmass of result.landmasses) {
      expect(landmass.coastalCellIds.every((id) =>
        graph.cells[id].neighbors.some((neighborId) => !isLand[neighborId]),
      )).toBeTrue();
    }
  });
});
