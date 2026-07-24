import {
  evaluateScatterPlacement,
  IScatterSurfaceSample,
} from './scatter-placement';
import { ScatterPlacementRules } from './scatter-species-definition';

function sample(overrides: Partial<IScatterSurfaceSample> = {}): IScatterSurfaceSample {
  return {
    worldPositionM: [0, 0, 0],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    slope01: 0,
    elevationM: 0,
    ...overrides,
  };
}

describe('evaluateScatterPlacement', () => {
  const baseRules: ScatterPlacementRules = { alignment: 'align-to-normal' };

  it('accepts when density seed is below the base density and no rules exclude it', () => {
    const result = evaluateScatterPlacement(
      { densitySeed01: 0.2 },
      sample(),
      baseRules,
      0.5,
    );
    expect(result).toEqual({ accepted: true });
  });

  it('rejects for density when the seed is at or above the base density', () => {
    const result = evaluateScatterPlacement(
      { densitySeed01: 0.5 },
      sample(),
      baseRules,
      0.5,
    );
    expect(result).toEqual({ accepted: false, rejectionReason: 'density' });
  });

  it('rejects for slope when below slopeMin01', () => {
    const rules: ScatterPlacementRules = { ...baseRules, slopeMin01: 0.3 };
    const result = evaluateScatterPlacement(
      { densitySeed01: 0 },
      sample({ slope01: 0.1 }),
      rules,
      1,
    );
    expect(result).toEqual({ accepted: false, rejectionReason: 'slope' });
  });

  it('rejects for slope when above slopeMax01', () => {
    const rules: ScatterPlacementRules = { ...baseRules, slopeMax01: 0.3 };
    const result = evaluateScatterPlacement(
      { densitySeed01: 0 },
      sample({ slope01: 0.9 }),
      rules,
      1,
    );
    expect(result).toEqual({ accepted: false, rejectionReason: 'slope' });
  });

  it('accepts within an inclusive slope window', () => {
    const rules: ScatterPlacementRules = {
      ...baseRules,
      slopeMin01: 0.2,
      slopeMax01: 0.4,
    };
    const result = evaluateScatterPlacement(
      { densitySeed01: 0 },
      sample({ slope01: 0.3 }),
      rules,
      1,
    );
    expect(result.accepted).toBeTrue();
  });

  it('excludes the candidate entirely when suitability is 0, regardless of density seed', () => {
    const result = evaluateScatterPlacement(
      { densitySeed01: 0 },
      sample(),
      baseRules,
      1,
      () => 0,
    );
    expect(result).toEqual({ accepted: false, rejectionReason: 'density' });
  });

  it('multiplies base density by the suitability callback', () => {
    // effective density = 1 * 0.5 = 0.5; seed just under it is accepted, just over is not.
    const accepted = evaluateScatterPlacement(
      { densitySeed01: 0.49 },
      sample(),
      baseRules,
      1,
      () => 0.5,
    );
    const rejected = evaluateScatterPlacement(
      { densitySeed01: 0.51 },
      sample(),
      baseRules,
      1,
      () => 0.5,
    );
    expect(accepted.accepted).toBeTrue();
    expect(rejected).toEqual({ accepted: false, rejectionReason: 'density' });
  });

  it('clamps a suitability callback that returns out-of-range values', () => {
    const result = evaluateScatterPlacement(
      { densitySeed01: 0.9 },
      sample(),
      baseRules,
      1,
      () => 5,
    );
    expect(result.accepted).toBeTrue();
  });
});
