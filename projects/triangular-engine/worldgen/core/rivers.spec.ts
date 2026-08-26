import { buildCornerGraph } from './corner-graph';
import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { traceRivers } from './rivers';
import { buildPlanetTectonics } from './tectonics';
import { IVec3 } from './vec3';

describe('traceRivers', () => {
  it('every river terminates at the coast or a lake', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      { seed: 41 },
    );

    const corners = buildCornerGraph(graph);
    const cornerIsLand = new Map<IVec3, boolean>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerIsLand.set(pos, tectonics.isLand[a] && tectonics.isLand[b] && tectonics.isLand[c]);
    });
    const lakeSet = new Set(rivers.lakeCorners);

    expect(rivers.riverPaths.length).toBeGreaterThan(0);
    for (const path of rivers.riverPaths) {
      const end = path[path.length - 1];
      const terminatesAtCoastOrLake = cornerIsLand.get(end) === false || lakeSet.has(end);
      expect(terminatesAtCoastOrLake).toBe(true);
    }
  });

  it('every step of every river strictly descends in elevation', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      { seed: 41 },
    );

    const corners = buildCornerGraph(graph);
    const cornerElevation = new Map<IVec3, number>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerElevation.set(pos, (tectonics.elevation[a] + tectonics.elevation[b] + tectonics.elevation[c]) / 3);
    });

    for (const path of rivers.riverPaths) {
      for (let i = 1; i < path.length; i++) {
        expect(cornerElevation.get(path[i])!).toBeLessThan(cornerElevation.get(path[i - 1])!);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 12 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 12 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const a = traceRivers(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation, climate.moisture, {
      seed: 3,
    });
    const b = traceRivers(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation, climate.moisture, {
      seed: 3,
    });
    expect(a).toEqual(b);
  });
});
