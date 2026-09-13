import { buildPlanetEcology } from './ecology';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetSurfaceBake } from './planet-surface-bake';
import { createPlanetSurfaceSampler } from './planet-surface';
import { buildPlanetTectonics } from './tectonics';

describe('buildPlanetSurfaceBake', () => {
  it('keeps deterministic cell metadata separate from filtered height data', () => {
    const graph = buildPlanetGraphCore({ cellCount: 120, seed: 17 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 7, seed: 17 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const a = buildPlanetSurfaceBake(graph, sampler, { width: 24, height: 12, heightScale: 3 });
    const b = buildPlanetSurfaceBake(graph, sampler, { width: 24, height: 12, heightScale: 3 });

    expect(a).toEqual(b);
    expect(a.elevations).toHaveLength(24 * 12);
    expect(a.cellIds).toHaveLength(24 * 12);
    expect(Array.from(a.cellIds).every((id) => id >= 0 && id < graph.cells.length)).toBe(true);
    expect(Array.from(a.landMask).every((value) => value === 0 || value === 1)).toBe(true);
  });

  it('allows a projection to mark texels outside its footprint', () => {
    const graph = buildPlanetGraphCore({ cellCount: 60, seed: 8 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 5, seed: 8 });
    const ecology = buildPlanetEcology(graph, tectonics);
    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology);
    const bake = buildPlanetSurfaceBake(graph, sampler, {
      width: 4,
      height: 2,
      projection: {
        directionAt: (x) => (x < 2.5 ? { x: 1, y: 0, z: 0 } : null),
      },
    });

    expect(Array.from(bake.cellIds).slice(0, 2).every((id) => id >= 0)).toBe(true);
    expect(Array.from(bake.cellIds).slice(2).every((id) => id === -1)).toBe(true);
    expect(Array.from(bake.elevations).slice(2).every((value) => value === 0)).toBe(true);
    expect(Array.from(bake.landMask).slice(2).every((value) => value === 0)).toBe(true);
  });
});
