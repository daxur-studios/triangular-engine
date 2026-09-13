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
});
