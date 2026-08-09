import { planLifeRoute } from './life-route-planner';

describe('planLifeRoute', () => {
  it('routes around deterministic blocked habitat cells', () => {
    const route = planLifeRoute({
      start: { x: -20, y: 0, z: 0 },
      goal: { x: 20, y: 0, z: 0 },
      allowedKinds: ['land'],
      cellSize: 10,
      query: {
        sampleHabitat: ({ x, z }) => ({
          kind: x === 0 && z === 0 ? 'water' : 'land',
          surfaceY: 0,
          suitability01: 1,
        }),
      },
    });
    expect(route).not.toBeNull();
    expect(route!.some((segment) => segment.from.z !== 0 || segment.to.z !== 0)).toBe(true);
  });

  it('returns null when no bounded path exists', () => {
    const route = planLifeRoute({
      start: { x: 0, y: 0, z: 0 },
      goal: { x: 20, y: 0, z: 0 },
      allowedKinds: ['land'],
      cellSize: 10,
      maxSearchNodes: 20,
      query: { sampleHabitat: () => ({ kind: 'water', surfaceY: 0, suitability01: 1 }) },
    });
    expect(route).toBeNull();
  });

  it('simplifies clear grid runs instead of exposing every search cell', () => {
    const route = planLifeRoute({
      start: { x: -40, y: 0, z: 0 },
      goal: { x: 40, y: 0, z: 0 },
      allowedKinds: ['land'],
      cellSize: 10,
      query: { sampleHabitat: () => ({ kind: 'land', surfaceY: 0, suitability01: 1 }) },
    });
    expect(route).not.toBeNull();
    expect(route!.length).toBe(1);
    expect(route![0].from.x).toBe(-40);
    expect(route![0].to.x).toBe(40);
  });
});
