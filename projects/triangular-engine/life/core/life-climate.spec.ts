import { createClimateAwareLifeHabitatQuery } from './life-climate';

describe('createClimateAwareLifeHabitatQuery', () => {
  it('combines weather suitability with terrain suitability at universal time', () => {
    const query = createClimateAwareLifeHabitatQuery(
      { sampleHabitat: () => ({ kind: 'meadow', surfaceY: 3, suitability01: 0.8 }) },
      { sampleClimate: (_position, time) => ({
        temperatureC: time! > 10 ? -5 : 20,
        precipitation01: 0.4,
        wind: { x: 1, y: 0, z: 0 },
        habitatSuitability01: time! > 10 ? 0.25 : 1,
      }) },
    );
    expect(query.sampleHabitat({ x: 0, y: 0, z: 0 }, 0).suitability01).toBeCloseTo(0.8);
    expect(query.sampleHabitat({ x: 0, y: 0, z: 0 }, 20).suitability01).toBeCloseTo(0.2);
  });
});
