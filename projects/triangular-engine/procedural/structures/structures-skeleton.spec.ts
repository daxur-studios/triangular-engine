import { DEMO_CHOPSTICK_TOWER_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';
import { generateStructureSkeleton } from './structures-skeleton';

describe('generateStructureSkeleton', () => {
  it('deterministically generates identical solids for identical seed', () => {
    const s1 = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 42);
    const s2 = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 42);

    expect(s1.length).toBe(s2.length);
    expect(s1.length).toBeGreaterThan(10); // Expands repeater stripes and pylons

    for (let i = 0; i < s1.length; i++) {
      expect(s1[i].id).toBe(s2[i].id);
      expect(s1[i].positionM).toEqual(s2[i].positionM);
      expect(s1[i].dimensionsM).toEqual(s2[i].dimensionsM);
    }
  });

  it('correctly expands repeated solids and assigns linkIds', () => {
    const solids = generateStructureSkeleton(DEMO_CHOPSTICK_TOWER_ARCHETYPE, 101);
    expect(solids.length).toBeGreaterThan(0);

    const link0 = solids.filter((s) => (s.linkId ?? 0) === 0);
    const link1 = solids.filter((s) => s.linkId === 1);
    const link2 = solids.filter((s) => s.linkId === 2);
    const link3 = solids.filter((s) => s.linkId === 3);

    expect(link0.length).toBeGreaterThan(0);
    expect(link1.length).toBeGreaterThan(0);
    expect(link2.length).toBeGreaterThan(0);
    expect(link3.length).toBeGreaterThan(0);
  });
});
