import { computeBiomes } from './biomes';
import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';
import { classifyWaterBodies } from './water-bodies';

const COLD_BIOMES = new Set(['tundra', 'taiga', 'glacier', 'ice_cap']);

describe('computeBiomes', () => {
  it('poles are always a cold biome, at any seed', () => {
    for (const seed of [2, 13, 88]) {
      const graph = buildPlanetGraphCore({ cellCount: 250, seed });
      const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed });
      const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
      const biomes = computeBiomes(
        graph,
        tectonics.elevation,
        tectonics.isLand,
        classifyWaterBodies(graph, tectonics.isLand).waterBodyKind,
        tectonics.ridgeCellIds,
        tectonics.seaLevelElevation,
        climate.temperature,
        climate.moisture,
      );

      const poleCells = graph.cells.filter((cell) => Math.abs(cell.center.y) > 0.92);
      expect(poleCells.length).toBeGreaterThan(0);
      for (const cell of poleCells) {
        expect(COLD_BIOMES.has(biomes.biome[cell.id])).toBe(true);
      }
    }
  });

  it('meadow cells have zero macro relief', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 35 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 35 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const biomes = computeBiomes(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      classifyWaterBodies(graph, tectonics.isLand).waterBodyKind,
      tectonics.ridgeCellIds,
      tectonics.seaLevelElevation,
      climate.temperature,
      climate.moisture,
    );

    const meadowIds = biomes.biome.map((b, id) => (b === 'meadow' ? id : -1)).filter((id) => id >= 0);
    expect(meadowIds.length).toBeGreaterThan(0);
    for (const id of meadowIds) {
      const landRelief =
        Math.max(...tectonics.elevation.filter((_, i) => tectonics.isLand[i])) - tectonics.seaLevelElevation;
      // 0.2 = computeBiomes()'s recalibrated flatnessSlopeFraction default (see its doc comment).
      expect(biomes.slope[id] / landRelief).toBeLessThan(0.2);
    }
  });

  it('ridge cells are always alpine, tracing a narrow line rather than covering most of the land', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 23 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 23 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const biomes = computeBiomes(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      classifyWaterBodies(graph, tectonics.isLand).waterBodyKind,
      tectonics.ridgeCellIds,
      tectonics.seaLevelElevation,
      climate.temperature,
      climate.moisture,
    );

    expect(tectonics.ridgeCellIds.length).toBeGreaterThan(0);
    for (const id of tectonics.ridgeCellIds) {
      // ridgeCellIds is plate-membership-based (continent-continent convergent), computed
      // before the sea-level percentile cut — a low-lying continental-shelf cell right on the
      // boundary can still end up underwater (isLand === false) and reports 'ocean'/'lake'
      // instead, same as computeBiomes() does for it (the ridge check is gated behind the
      // land branch). A frozen land ridge cell still reports a cold biome instead of 'alpine'
      // (see computeBiomes' doc comment). Only a non-frozen *land* ridge cell is guaranteed
      // 'alpine'.
      if (!tectonics.isLand[id] || climate.temperature[id] <= -0.35) continue;
      expect(biomes.biome[id]).toBe('alpine');
    }

    const landCount = tectonics.isLand.filter(Boolean).length;
    const alpineCount = biomes.biome.filter((b) => b === 'alpine').length;
    expect(alpineCount).toBeLessThan(landCount * 0.5);
  });

  it('deserts never touch the coast (interior/rain-shadow only)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 35 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 35 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const biomes = computeBiomes(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      classifyWaterBodies(graph, tectonics.isLand).waterBodyKind,
      tectonics.ridgeCellIds,
      tectonics.seaLevelElevation,
      climate.temperature,
      climate.moisture,
    );

    const desertIds = biomes.biome.map((b, id) => (b === 'desert' ? id : -1)).filter((id) => id >= 0);
    expect(desertIds.length).toBeGreaterThan(0);
    for (const id of desertIds) {
      const isCoastal = graph.cells[id].neighbors.some((n) => !tectonics.isLand[n]);
      expect(isCoastal).toBe(false);
    }
  });
});
