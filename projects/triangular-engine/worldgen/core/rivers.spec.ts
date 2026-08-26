import { buildCornerGraph } from './corner-graph';
import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { traceRivers } from './rivers';
import { buildPlanetTectonics } from './tectonics';
import { add, IVec3, normalize, scale, sub } from './vec3';

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
    const cornerElevation = new Map<IVec3, number>();
    corners.position.forEach((pos, i) => {
      const [a, b, c] = corners.cellIds[i];
      cornerElevation.set(pos, (tectonics.elevation[a] + tectonics.elevation[b] + tectonics.elevation[c]) / 3);
    });
    const lakeSet = new Set(rivers.lakeCorners);

    expect(rivers.riverPaths.length).toBeGreaterThan(0);
    for (const path of rivers.riverPaths) {
      const end = path[path.length - 1];
      if (lakeSet.has(end)) continue;

      // A coast terminus is a fresh point interpolated exactly at sea level on the
      // edge from the last land corner to whichever neighbor it stepped toward —
      // not itself a graph corner — so verify it geometrically instead of by identity.
      const secondToLast = path[path.length - 2];
      expect(cornerElevation.get(secondToLast)).toBeGreaterThanOrEqual(tectonics.seaLevelElevation);

      const idx = corners.position.indexOf(secondToLast);
      let bestNeighbor = -1;
      let bestElevation = cornerElevation.get(secondToLast)!;
      for (const n of corners.neighbors[idx]) {
        const e = cornerElevation.get(corners.position[n])!;
        if (e < bestElevation) {
          bestElevation = e;
          bestNeighbor = n;
        }
      }
      expect(bestNeighbor).toBeGreaterThanOrEqual(0);

      const from = secondToLast;
      const to = corners.position[bestNeighbor];
      const eFrom = cornerElevation.get(from)!;
      const eTo = cornerElevation.get(to)!;
      const t = (tectonics.seaLevelElevation - eFrom) / (eTo - eFrom);
      const expected = normalize(add(from, scale(sub(to, from), t)));
      expect(end.x).toBeCloseTo(expected.x, 9);
      expect(end.y).toBeCloseTo(expected.y, 9);
      expect(end.z).toBeCloseTo(expected.z, 9);
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
    // A path's last point may be a fresh sea-level crossing point rather than a graph
    // corner (see the "terminates at the coast or a lake" test above) — its elevation
    // is exactly seaLevelElevation by construction.
    const elevationOf = (p: IVec3): number => cornerElevation.get(p) ?? tectonics.seaLevelElevation;

    for (const path of rivers.riverPaths) {
      for (let i = 1; i < path.length; i++) {
        expect(elevationOf(path[i])).toBeLessThan(elevationOf(path[i - 1]));
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
