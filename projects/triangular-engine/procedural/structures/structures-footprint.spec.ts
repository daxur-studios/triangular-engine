import { DEMO_LAUNCHPAD_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';
import { deriveStructureFootprint2D } from './structures-footprint';

describe('deriveStructureFootprint2D', () => {
  it('derives rect footprint with bounding radius for runways', () => {
    const fp = deriveStructureFootprint2D(DEMO_RUNWAY_ARCHETYPE, 42);
    expect(fp.kind).toBe('rect');
    expect(fp.dimensionsM).toEqual([20, 200]);
    expect(fp.boundingRadiusM).toBeCloseTo(Math.sqrt(20 * 20 + 200 * 200), 2);
    expect(fp.foundationDepthM).toBe(0.4);
  });

  it('derives circle footprint for launchpads', () => {
    const fp = deriveStructureFootprint2D(DEMO_LAUNCHPAD_ARCHETYPE, 42);
    expect(fp.kind).toBe('circle');
    expect(fp.dimensionsM).toEqual([32]);
    expect(fp.boundingRadiusM).toBe(32);
    expect(fp.foundationDepthM).toBe(0.8);
  });
});
