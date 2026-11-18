import { buildPlanetGraphCore, planetGraphCacheKey, prewarmPlanetGraphs } from './planet-graph';

describe('planet graph cache', () => {
  it('returns independent graphs for the same recipe', () => {
    const recipe = { cellCount: 60, seed: 9101, relaxationIterations: 1 };
    const first = buildPlanetGraphCore(recipe);
    const originalCenter = first.cells[0].center.x;
    first.cells[0].center.x = 123;
    first.cells[0].neighbors.length = 0;
    const second = buildPlanetGraphCore({ ...recipe });
    expect(second).not.toBe(first);
    expect(second.cells[0].center.x).toBe(originalCenter);
    expect(second.cells[0].neighbors.length).toBeGreaterThan(0);
  });

  it('keys differ by seed and cell count, and fill in defaults', () => {
    const base = { cellCount: 60, seed: 1 };
    expect(planetGraphCacheKey(base)).not.toBe(planetGraphCacheKey({ ...base, seed: 2 }));
    expect(planetGraphCacheKey(base)).not.toBe(planetGraphCacheKey({ ...base, cellCount: 61 }));
    expect(planetGraphCacheKey(base)).toBe(planetGraphCacheKey({ ...base, relaxationIterations: 2 }));
  });

  it('prewarm resolves for a recipe with nothing stored', async () => {
    await expectAsync(prewarmPlanetGraphs([{ cellCount: 60, seed: 9102 }])).toBeResolved();
  });
});
