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

    let detailedPathFound = false;
    for (const path of ridges.ridgePaths) {
      expect(path.length).toBeGreaterThanOrEqual(2);
      detailedPathFound ||= path.length > 2;
      for (const point of path) {
        expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 8);
      }
      expect(cellIdByCenter.has(path[0])).toBe(true);
      expect(cellIdByCenter.has(path[path.length - 1])).toBe(true);
    }
    expect(detailedPathFound).toBe(true);
    for (const peak of ridges.ridgePeaks) {
      expect(Math.hypot(peak.x, peak.y, peak.z)).toBeCloseTo(1, 8);
    }
    expect(ridges.ridgePeakCellIds.length).toBe(ridges.ridgePeaks.length);
  });

  it('lets an established river break a candidate ridge link', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 51 });
    const params = { ridgeDetail: { stationCount: 2 } };
    const unconstrained = buildPlanetRidges(graph, tectonics, params);
    expect(unconstrained.ridgePaths.length).toBeGreaterThan(0);

    const blockedRiver = unconstrained.ridgePaths[0];
    const constrained = buildPlanetRidges(graph, tectonics, params, [blockedRiver]);
    const blockedStart = blockedRiver[0];
    const blockedEnd = blockedRiver[blockedRiver.length - 1];
    const containsBlockedLink = constrained.ridgePaths.some((path) =>
      path.some((point, i) =>
        i < path.length - 1 &&
        ((point === blockedStart && path[i + 1] === blockedEnd) ||
          (point === blockedEnd && path[i + 1] === blockedStart)),
      ),
    );

    expect(containsBlockedLink).toBe(false);
  });
});
