import { localSolarLighting } from './local-solar-lighting';

describe('localSolarLighting', () => {
  it('removes direct sunlight when the source is below the horizon', () => {
    const state = localSolarLighting([0, 1, 0], [0, 0, 0], [0, -10, 0], 1);
    expect(state.directSunFactor01).toBe(0);
    expect(state.skyLightFactor01).toBeLessThan(0.2);
  });

  it('preserves eclipse attenuation in daylight', () => {
    const state = localSolarLighting([0, 1, 0], [0, 0, 0], [0, 10, 0], 0.25);
    expect(state.directSunFactor01).toBeCloseTo(0.25);
    expect(state.horizonVisibility01).toBe(1);
  });
});
