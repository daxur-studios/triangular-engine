import { createCoastlineQuery, extractCoastlineSegments, extractCoastlines } from './coastlines';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';
import { length, normalize, sub } from './vec3';

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

  it('uses the supplied final cell mask for ownership and coastline edges', () => {
    const graph = buildPlanetGraphCore({ cellCount: 120, seed: 19 });
    const finalMask = new Array(graph.cells.length).fill(true);
    const flippedCellId = 0;
    finalMask[flippedCellId] = false;
    const query = createCoastlineQuery(graph, finalMask);

    expect(query.segments.length).toBe(graph.cells[flippedCellId]!.neighbors.length);
    expect(query.segments.every((segment) => segment.waterCellId === flippedCellId)).toBe(true);
    expect(query.sample(graph.cells[flippedCellId]!.center).isLand).toBe(false);
    expect(query.sample(graph.cells[graph.cells[flippedCellId]!.neighbors[0]!]!.center).isLand).toBe(true);
  });

  it('returns zero on shared edges and signed distances on both sides', () => {
    const graph = buildPlanetGraphCore({ cellCount: 180, seed: 7 });
    const mask = new Array(graph.cells.length).fill(true);
    mask[0] = false;
    const query = createCoastlineQuery(graph, mask);
    const segment = query.segments[0]!;
    const midpoint = normalize({
      x: segment.start.x + segment.end.x,
      y: segment.start.y + segment.end.y,
      z: segment.start.z + segment.end.z,
    });
    const landCenter = graph.cells[segment.landCellId]!.center;
    const waterCenter = graph.cells[segment.waterCellId]!.center;
    const toward = (center: typeof midpoint) => normalize({
      x: midpoint.x * 0.98 + center.x * 0.02,
      y: midpoint.y * 0.98 + center.y * 0.02,
      z: midpoint.z * 0.98 + center.z * 0.02,
    });

    expect(query.sample(midpoint).signedDistanceRadians).toBe(0);
    expect(query.sample(toward(landCenter)).signedDistanceRadians).toBeGreaterThan(0);
    expect(query.sample(toward(waterCenter)).signedDistanceRadians).toBeLessThan(0);
    expect(query.sample(midpoint).segment?.id).toBe(segment.id);
  });

  it('keeps extracted segment ids and nearest results deterministic', () => {
    const graph = buildPlanetGraphCore({ cellCount: 220, seed: 31 });
    const mask = graph.cells.map((cell) => cell.id % 3 === 0);
    const first = createCoastlineQuery(graph, mask);
    const second = createCoastlineQuery(graph, mask);

    expect(first.segments).toEqual(extractCoastlineSegments(graph, mask));
    expect(first.sample(graph.cells[40]!.center)).toEqual(second.sample(graph.cells[40]!.center));
  });

  it('rejects a mask that does not describe every graph cell', () => {
    const graph = buildPlanetGraphCore({ cellCount: 40, seed: 2 });
    expect(() => createCoastlineQuery(graph, [true])).toThrow(/mask length/i);
  });
});
