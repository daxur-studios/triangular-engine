import { ICelestialBody } from '../bodies/celestial-body';
import { HOME_PLANET } from '../bodies/stock-bodies';
import { rocheLimits } from './roche';

describe('rocheLimits', () => {
  it('throws RangeError if body radius is not positive', () => {
    const invalidBody: ICelestialBody = {
      ...HOME_PLANET,
      radiusM: 0,
    };
    expect(() => rocheLimits(invalidBody)).toThrowError(RangeError);
  });

  it('calculates rigid and fluid Roche limits with default density ratio 1.0', () => {
    const limits = rocheLimits(HOME_PLANET);
    expect(limits.rigidRadiusM).toBeCloseTo(HOME_PLANET.radiusM * 1.259921, 0);
    expect(limits.fluidRadiusM).toBeCloseTo(HOME_PLANET.radiusM * 2.44, 0);
  });

  it('scales correctly with custom density ratio', () => {
    const limits2 = rocheLimits(HOME_PLANET, 8.0);
    // cbrt(8) = 2
    expect(limits2.rigidRadiusM).toBeCloseTo(
      HOME_PLANET.radiusM * 1.259921 * 2,
      0,
    );
    expect(limits2.fluidRadiusM).toBeCloseTo(HOME_PLANET.radiusM * 2.44 * 2, 0);
  });
});
