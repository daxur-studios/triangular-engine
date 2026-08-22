import {
  COLONY_SOLAR_PANEL_ARCHETYPE,
  DEMO_LAUNCHPAD_ARCHETYPE,
  StructureGeometryCache,
} from './public-api';

describe('StructureGeometryCache', () => {
  let cache: StructureGeometryCache;

  beforeEach(() => {
    cache = new StructureGeometryCache();
  });

  afterEach(() => {
    cache.clear();
  });

  it('creates and caches geometry on first request', () => {
    expect(cache.size).toBe(0);
    const geom1 = cache.getOrCreate(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(cache.size).toBe(1);
    expect(geom1.getAttribute('position')).toBeDefined();

    // Second request with same archetype and seed should return exact same instance
    const geom2 = cache.getOrCreate(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(cache.size).toBe(1);
    expect(geom2).toBe(geom1);
  });

  it('differentiates by seed', () => {
    const geom1 = cache.getOrCreate(COLONY_SOLAR_PANEL_ARCHETYPE, 42);
    const geom2 = cache.getOrCreate(COLONY_SOLAR_PANEL_ARCHETYPE, 99);
    expect(cache.size).toBe(2);
    expect(geom1).not.toBe(geom2);
  });

  it('differentiates by LOD level', () => {
    const lod0 = cache.getOrCreate(COLONY_SOLAR_PANEL_ARCHETYPE, 42, 0);
    const lod1 = cache.getOrCreate(COLONY_SOLAR_PANEL_ARCHETYPE, 42, 1);
    expect(cache.size).toBe(2);
    expect(lod0).not.toBe(lod1);
  });

  it('handles reference counting and release', () => {
    cache.getOrCreate(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    cache.getOrCreate(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(cache.size).toBe(1);

    cache.release(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(cache.size).toBe(1); // refCount dropped from 2 to 1

    cache.release(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(cache.size).toBe(0); // disposed and removed
  });
});
