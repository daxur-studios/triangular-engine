import { normalizeLifeLodProfile, selectLifeLod } from './life-lod';

describe('selectLifeLod', () => {
  const profile = { individualDistance: 10, groupDistance: 30, ambientDistance: 80 };

  it('keeps large nearby life individual and culls distant life', () => {
    expect(selectLifeLod(5, profile)).toBe('individual');
    expect(selectLifeLod(20, profile)).toBe('group');
    expect(selectLifeLod(50, profile)).toBe('ambient');
    expect(selectLifeLod(100, profile)).toBe('hidden');
  });

  it('supports species-specific culling thresholds', () => {
    expect(selectLifeLod(40, { individualDistance: 18, groupDistance: 65, ambientDistance: 150 })).toBe('group');
    expect(selectLifeLod(40, { individualDistance: 140, groupDistance: 500, ambientDistance: 1600 })).toBe('individual');
  });

  it('normalizes invalid threshold ordering', () => {
    expect(normalizeLifeLodProfile({ individualDistance: 30, groupDistance: 10, ambientDistance: 2 })).toEqual({
      individualDistance: 30,
      groupDistance: 30,
      ambientDistance: 30,
    });
  });
});
