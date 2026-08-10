import { createNavigationRegionGraph, findNavigationRegionRoute, NavigationRouteCache } from './navigation-region';

const profile = { id: 'villager', domains: ['ground'], radius: 0.5, height: 1 } as const;

describe('navigation region routing', () => {
  it('finds a deterministic portal route and records edge dependencies', () => {
    const graph = createNavigationRegionGraph({
      regionIds: ['home', 'road', 'work'],
      edges: [
        { id: 'home-road', version: 1, fromRegionId: 'home', toRegionId: 'road', domain: 'ground', cost: 1 },
        { id: 'road-work', version: 1, fromRegionId: 'road', toRegionId: 'work', domain: 'ground', cost: 2 },
      ],
    });
    const route = findNavigationRegionRoute({ graph, startRegionId: 'home', goalRegionId: 'work', profile });

    expect(route.status).toBe('complete');
    expect(route.regionIds).toEqual(['home', 'road', 'work']);
    expect(route.dependencies.map((dependency) => dependency.id)).toEqual(['home-road', 'road-work']);
  });

  it('reuses complete routes and rejects cached routes after an edge version changes', () => {
    const graph = createNavigationRegionGraph({
      regionIds: ['a', 'b'],
      edges: [{ id: 'a-b', version: 1, fromRegionId: 'a', toRegionId: 'b', domain: 'ground', cost: 1 }],
    });
    const route = findNavigationRegionRoute({ graph, startRegionId: 'a', goalRegionId: 'b', profile });
    const cache = new NavigationRouteCache();
    cache.set(graph, 'a', 'b', profile, route);
    expect(cache.get(graph, 'a', 'b', profile)).toBe(route);

    const changed = createNavigationRegionGraph({
      version: 2,
      regionIds: ['a', 'b'],
      edges: [{ id: 'a-b', version: 2, fromRegionId: 'a', toRegionId: 'b', domain: 'ground', cost: 1 }],
    });
    expect(cache.get(changed, 'a', 'b', profile)).toBeUndefined();
  });
});
