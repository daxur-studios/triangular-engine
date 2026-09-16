import { PlanetTerrainField } from './planet-terrain-field';

describe('PlanetTerrainField', () => {
  const field = new PlanetTerrainField();

  it('is deterministic and finite for directions across the sphere', () => {
    const directions: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
      [-0.4, 0.7, 0.2],
    ];
    for (const direction of directions) {
      const first = field.features(direction);
      const second = field.features(direction);
      expect(first).toEqual(second);
      expect(Number.isFinite(first.elevationM)).toBeTrue();
      expect(first.elevationM).toBeGreaterThanOrEqual(field.minElevationM);
      expect(first.elevationM).toBeLessThanOrEqual(field.maxElevationM);
    }
  });

  it('matches scalar and packed batch sampling', () => {
    const positions = new Float64Array([
      1, 0, 0,
      0, 2, 0,
      0.2, -0.4, 0.8,
    ]);
    const batch = field.sampleBatch(positions);
    expect(Array.from(batch)).toEqual([
      field.sample([1, 0, 0]).elevationM,
      field.sample([0, 2, 0]).elevationM,
      field.sample([0.2, -0.4, 0.8]).elevationM,
    ]);
  });

  it('exposes distinct geological channels for the fixture', () => {
    const samples = [
      field.features([0.8, 0.33, 0.5]),
      field.features([0.68, 0.5, -0.53]),
      field.features([-0.44, 0.24, -0.86]),
    ];
    expect(samples.some((sample) => sample.volcano > 0.1)).toBeTrue();
    expect(samples.some((sample) => sample.crater > 0.1)).toBeTrue();
    expect(samples.some((sample) => sample.mesa > 0.1)).toBeTrue();
  });
});
