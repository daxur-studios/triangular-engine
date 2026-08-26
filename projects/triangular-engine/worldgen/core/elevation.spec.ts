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
});
