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

  it('deserts can be coastal, not just interior (subtropical arid belt)', () => {
    // Real deserts are frequently coastal (Atacama, Namib, Baja California) — driven by
    // subtropical high-pressure belts suppressing rainfall independent of distance from the
    // ocean. See computeClimate()'s aridBelt doc comment and runbook 022.
    //
    // The belt was recalibrated 2026-08-31 to sit poleward of the tropics instead of on top of
    // them (see climate.ts's DEFAULTS comment) specifically so desert stops being the dominant
    // biome every generation — as a result it's now a comparatively rare, targeted biome rather
    // than a wide band, so any single seed may legitimately produce zero of it. Checking across
    // several seeds (same pattern as this file's other "at any seed" tests) confirms the
    // capability without depending on one seed happening to roll a coastal desert.
    let coastalDesertCount = 0;
    for (const seed of [3, 12, 41, 45, 60, 77, 88, 101]) {
      const graph = buildPlanetGraphCore({ cellCount: 300, seed });
      const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed });
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
      coastalDesertCount += desertIds.filter((id) =>
        graph.cells[id].neighbors.some((n) => !tectonics.isLand[n]),
      ).length;
    }
    expect(coastalDesertCount).toBeGreaterThan(0);
  });

  it('ice cap extent varies by seed but never exceeds the coldTemperatureThreshold baseline', () => {
    // Fixed 2026-08-31: temperature has no seed/noise term (see computeClimate()), so before this
    // fix every generation produced an identical ice cap. `iceCapVariability` draws one seeded
    // scalar per planet that only ever shrinks the effective threshold — see biomes.ts's doc
    // comment — so the unseeded (`seed` omitted) call is always the largest any generation can be.
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 20 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 12, seed: 20 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const waterBodyKind = classifyWaterBodies(graph, tectonics.isLand).waterBodyKind;

    const countCold = (biome: string[]) => biome.filter((b) => COLD_BIOMES.has(b)).length;

    const baseline = computeBiomes(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      waterBodyKind,
      tectonics.ridgeCellIds,
      tectonics.seaLevelElevation,
      climate.temperature,
      climate.moisture,
    );
    const baselineColdCount = countCold(baseline.biome);

    const seededColdCounts = [1, 2, 3, 4, 5].map((seed) =>
      countCold(
        computeBiomes(
          graph,
          tectonics.elevation,
          tectonics.isLand,
          waterBodyKind,
          tectonics.ridgeCellIds,
          tectonics.seaLevelElevation,
          climate.temperature,
          climate.moisture,
          { seed },
        ).biome,
      ),
    );

    for (const count of seededColdCounts) {
      expect(count).toBeLessThanOrEqual(baselineColdCount);
    }
    expect(Math.min(...seededColdCounts)).toBeLessThan(baselineColdCount);
  });
});
