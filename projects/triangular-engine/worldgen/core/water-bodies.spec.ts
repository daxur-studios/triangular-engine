import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';
import { classifyWaterBodies } from './water-bodies';

describe('classifyWaterBodies', () => {
  it('every water cell is classified, and adjacent water cells always share a kind', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 7 });
    const { waterBodyKind } = classifyWaterBodies(graph, tectonics.isLand);

    let oceanCount = 0;
    for (const cell of graph.cells) {
      if (tectonics.isLand[cell.id]) {
        expect(waterBodyKind[cell.id]).toBeNull();
        continue;
      }
      expect(waterBodyKind[cell.id]).not.toBeNull();
      if (waterBodyKind[cell.id] === 'ocean') oceanCount++;

      for (const n of cell.neighbors) {
        if (tectonics.isLand[n]) continue;
        expect(waterBodyKind[n]).toBe(waterBodyKind[cell.id]);
      }
    }
    expect(oceanCount).toBeGreaterThan(0);
  });

  it('a single land-locked water cell is classified as a lake, not ocean', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 7 });
    const isLand = [...tectonics.isLand];

    // A land cell every one of whose neighbors is also land — flipping only this one cell
    // to water guarantees an isolated 1-cell pocket, disconnected from the real ocean.
    const pocketId = graph.cells.findIndex((cell) => isLand[cell.id] && cell.neighbors.every((n) => isLand[n]));
    expect(pocketId).toBeGreaterThanOrEqual(0);
    isLand[pocketId] = false;

    const { waterBodyKind } = classifyWaterBodies(graph, isLand);
    expect(waterBodyKind[pocketId]).toBe('lake');
    expect(waterBodyKind.some((k) => k === 'ocean')).toBe(true);
  });

  it('returns all-null when there is no water', () => {
    const graph = buildPlanetGraphCore({ cellCount: 50, seed: 1 });
    const isLand = graph.cells.map(() => true);
    const { waterBodyKind } = classifyWaterBodies(graph, isLand);
    expect(waterBodyKind.every((k) => k === null)).toBe(true);
  });
});
