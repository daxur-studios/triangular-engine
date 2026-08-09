import { FOUR_SEASON_CYCLE, createSeasonalLifeHabitatQuery, sampleLifeSeasonAtTime, sampleLifeSeasonResponse } from './life-seasons';

describe('life seasons', () => {
  it('reconstructs the same season from arbitrary universal time access', () => {
    const first = sampleLifeSeasonAtTime(FOUR_SEASON_CYCLE, 20_000_000);
    sampleLifeSeasonAtTime(FOUR_SEASON_CYCLE, 1);
    expect(sampleLifeSeasonAtTime(FOUR_SEASON_CYCLE, 20_000_000)).toEqual(first);
  });

  it('wraps years and produces migration pressure near a transition', () => {
    const winter = sampleLifeSeasonAtTime({ ...FOUR_SEASON_CYCLE, yearLengthSeconds: 100 }, 98);
    expect(winter.season.id).toBe('winter');
    const response = sampleLifeSeasonResponse(winter, ['summer']);
    expect(response.migrationPressure01).toBeGreaterThan(0.65);
  });

  it('applies seasonal suitability without changing base habitat kind', () => {
    const query = createSeasonalLifeHabitatQuery({
      sampleHabitat: () => ({ kind: 'meadow', surfaceY: 2, suitability01: 1 }),
    }, { ...FOUR_SEASON_CYCLE, yearLengthSeconds: 100 }, ['summer']);
    expect(query.sampleHabitat({ x: 0, y: 0, z: 0 }, 30).kind).toBe('meadow');
    expect(query.sampleHabitat({ x: 0, y: 0, z: 0 }, 30).suitability01).toBeGreaterThan(
      query.sampleHabitat({ x: 0, y: 0, z: 0 }, 80).suitability01,
    );
  });
});
