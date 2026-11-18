import { buildPlanetGraphCore, planetGraphCacheKey, prewarmPlanetGraphs } from './planet-graph';

describe('planet graph cache', () => {
  it('returns the same graph for the same recipe', () => {
    const recipe = { cellCount: 60, seed: 9101, relaxationIterations: 1 };
    expect(buildPlanetGraphCore(recipe)).toBe(buildPlanetGraphCore({ ...recipe }));
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
