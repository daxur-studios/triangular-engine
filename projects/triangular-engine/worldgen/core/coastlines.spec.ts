import { extractCoastlines } from './coastlines';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';
import { length, sub } from './vec3';

describe('extractCoastlines', () => {
  it('extracts coastlines as closed loops', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 11 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 11 });
    const loops = extractCoastlines(graph, tectonics.isLand);

    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      expect(loop.length).toBeGreaterThanOrEqual(3);

      // Closed: the wraparound edge (last -> first) is no larger than any
      // other consecutive step in the loop, i.e. it's a real edge, not a gap
      // left by a broken chain.
      let maxGap = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        maxGap = Math.max(maxGap, length(sub(a, b)));
      }
      expect(maxGap).toBeLessThan(0.5);
    }
  });

  it('is deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 6 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 6 });
    const a = extractCoastlines(graph, tectonics.isLand);
    const b = extractCoastlines(graph, tectonics.isLand);
    expect(a).toEqual(b);
  });

  it('produces no coastline when the whole graph is one class', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 4 });
    const allLand = new Array(graph.cells.length).fill(true);
    expect(extractCoastlines(graph, allLand)).toEqual([]);
  });
});
