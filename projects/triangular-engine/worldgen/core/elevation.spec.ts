import { computeElevation } from './elevation';
import { buildPlanetGraphCore } from './planet-graph';
import { classifyBoundaries } from './plate-boundaries';
import { buildPlates } from './plate-tectonics';

describe('computeElevation', () => {
  it('hits the target land fraction within a loose tolerance', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 11 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 10, seed: 11 });
    const boundaries = classifyBoundaries(graph, plates, plateIdByCell);
    const { isLand } = computeElevation(graph, plates, plateIdByCell, boundaries, {
      seed: 11,
      targetLandFraction: 0.3,
    });

    const landFraction = isLand.filter(Boolean).length / isLand.length;
    expect(landFraction).toBeGreaterThan(0.25);
    expect(landFraction).toBeLessThan(0.35);
  });

  it('is fully deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 6 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 8, seed: 6 });
    const boundaries = classifyBoundaries(graph, plates, plateIdByCell);
    const a = computeElevation(graph, plates, plateIdByCell, boundaries, { seed: 6 });
    const b = computeElevation(graph, plates, plateIdByCell, boundaries, { seed: 6 });
    expect(a).toEqual(b);
  });

  it('gives continental cells a higher mean elevation than oceanic cells', () => {
    const graph = buildPlanetGraphCore({ cellCount: 250, seed: 14 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 8, seed: 14 });
    const boundaries = classifyBoundaries(graph, plates, plateIdByCell);
    const { elevation } = computeElevation(graph, plates, plateIdByCell, boundaries, { seed: 14 });

    const continental = elevation.filter((_, i) => plates[plateIdByCell[i]].type === 'continental');
    const oceanic = elevation.filter((_, i) => plates[plateIdByCell[i]].type === 'oceanic');
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

    expect(mean(continental)).toBeGreaterThan(mean(oceanic));
  });

  it('never leaves a land/water region smaller than the configured minimum (no salt-and-pepper islands/lakes)', () => {
    // Fixed 2026-08-31: independent per-cell noise crossing the percentile-based sea-level cutoff
    // used to produce isolated single-cell islands/lakes, worse at higher cell counts — see
    // computeElevation()'s doc comment. Checked at 1500 cells specifically because the bug's
    // reporter observed it getting worse with scale.
    for (const seed of [4, 17, 33]) {
      const graph = buildPlanetGraphCore({ cellCount: 1500, seed });
      const { plates, plateIdByCell } = buildPlates(graph, { plateCount: Math.round(1500 / 30), seed });
      const boundaries = classifyBoundaries(graph, plates, plateIdByCell);
      const { isLand } = computeElevation(graph, plates, plateIdByCell, boundaries, { seed });

      const cellCount = graph.cells.length;
      const minSize = Math.max(2, Math.round(cellCount * 0.0015));
      const visited = new Array<boolean>(cellCount).fill(false);

      for (let start = 0; start < cellCount; start++) {
        if (visited[start]) continue;
        const kind = isLand[start];
        let size = 0;
        let frontier = [start];
        visited[start] = true;
        while (frontier.length > 0) {
          const next: number[] = [];
          for (const id of frontier) {
            size++;
            for (const neighborId of graph.cells[id].neighbors) {
              if (visited[neighborId] || isLand[neighborId] !== kind) continue;
              visited[neighborId] = true;
              next.push(neighborId);
            }
          }
          frontier = next;
        }
        expect(size).toBeGreaterThanOrEqual(minSize);
      }
    }
  });
});
