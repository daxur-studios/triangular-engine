import { buildPlanetEcology } from './ecology';
import { diffPlanetEcology } from './ecology-diff';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';

describe('diffPlanetEcology', () => {
  it('reports no changes when diffing a snapshot against itself', () => {
    const graph = buildPlanetGraphCore({ cellCount: 250, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 7 });
    const ecology = buildPlanetEcology(graph, tectonics);

    const diff = diffPlanetEcology(ecology, ecology);

    expect(diff.biomeChangedCellIds).toEqual([]);
    expect(diff.waterBodyChangedCellIds).toEqual([]);
    expect(diff.riversAdded).toEqual([]);
    expect(diff.riversRemoved).toEqual([]);
  });

  it('detects biome/water-body/river changes between a baseline and a colder, wetter snapshot', () => {
    const graph = buildPlanetGraphCore({ cellCount: 250, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 7 });

    const baseline = buildPlanetEcology(graph, tectonics);
    const colder = buildPlanetEcology(graph, tectonics, {
      climate: { baseTemperatureOffset: -0.6 },
    });

    const diff = diffPlanetEcology(baseline, colder);

    expect(diff.biomeChangedCellIds.length).toBeGreaterThan(0);
    for (const id of diff.biomeChangedCellIds) {
      expect(baseline.biome[id]).not.toBe(colder.biome[id]);
    }

    // River identity survives across the recompute by headwater corner id, not array position.
    const baselineHeadwaters = new Set(baseline.riverHeadwaterCornerId);
    for (const id of diff.riversRemoved) expect(baselineHeadwaters.has(id)).toBe(true);
    const colderHeadwaters = new Set(colder.riverHeadwaterCornerId);
    for (const id of diff.riversAdded) expect(colderHeadwaters.has(id)).toBe(true);
  });
});
