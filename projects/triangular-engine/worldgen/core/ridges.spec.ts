import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetRidges } from './ridges';
import { buildPlanetTectonics } from './tectonics';

describe('buildPlanetRidges', () => {
  it('is deterministic and keeps path strength aligned with paths', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 50 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 50 });

    const a = buildPlanetRidges(graph, tectonics);
    const b = buildPlanetRidges(graph, tectonics);

    expect(a).toEqual(b);
    expect(a.ridgePaths.length).toBe(a.ridgePathStrength.length);
    expect(a.ridgePaths.length + a.ridgePeaks.length).toBeGreaterThan(0);
  });

  it('produces valid open paths and unit summit positions', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 27 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 27 });
    const ridges = buildPlanetRidges(graph, tectonics);
    const cellIdByCenter = new Map(graph.cells.map((cell) => [cell.center, cell.id]));

    for (const path of ridges.ridgePaths) {
      expect(path.length).toBeGreaterThanOrEqual(2);
      for (const point of path) {
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 8);
      }
      for (let i = 0; i < path.length - 1; i++) {
        const from = cellIdByCenter.get(path[i]);
        const to = cellIdByCenter.get(path[i + 1]);
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        expect(graph.cells[from!].neighbors).toContain(to);
      }
    }
    for (const peak of ridges.ridgePeaks) {
      expect(Math.hypot(peak.x, peak.y, peak.z)).toBeCloseTo(1, 8);
    }
    expect(ridges.ridgePeakCellIds.length).toBe(ridges.ridgePeaks.length);
  });
});
