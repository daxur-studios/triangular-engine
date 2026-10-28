import {
  evaluateScatterDensityField,
  evaluateScatterHeightBand,
  scatterValueNoise3,
  type IScatterDensityFieldDefinition,
} from './scatter-density-field';

const RADIUS_M = 600_000;
const field: IScatterDensityFieldDefinition = {
  octaves: [
    { cellM: 6000, weight: 0.55 },
    { cellM: 1500, weight: 0.3 },
    { cellM: 120, weight: 0.15 },
  ],
  edge: [0.45, 0.62],
  heightBandM: { rise: [5, 40], fall: [1800, 2600] },
};

describe('scatter density field', () => {
  it('is continuous: a step of a metre moves the noise by a hair', () => {
    for (const cell of [120, 1500, 6000]) {
      const a = scatterValueNoise3(600_000, 1234, -4321, cell, 1);
      const b = scatterValueNoise3(600_001, 1234, -4321, cell, 1);
      expect(Math.abs(a - b)).toBeLessThan(2 / cell);
    }
  });

  it('stays within [0, 1] and covers a share of land between bare and solid', () => {
    let some = 0;
    let solid = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const lon = i * 0.7;
      const d = evaluateScatterDensityField(field, Math.sin(lon) * RADIUS_M, 300 + i * 11, Math.cos(lon) * RADIUS_M, 200);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      if (d > 0) some++;
      if (d === 1) solid++;
    }
    expect(some / n).toBeGreaterThan(0.2);
    expect(some / n).toBeLessThan(0.8);
    expect(solid).toBeGreaterThan(0);
  });

  it('applies the height band at both ends, and none without one', () => {
    expect(evaluateScatterHeightBand(field.heightBandM, 0)).toBe(0);
    expect(evaluateScatterHeightBand(field.heightBandM, 500)).toBe(1);
    expect(evaluateScatterHeightBand(field.heightBandM, 3000)).toBe(0);
    expect(evaluateScatterHeightBand({ rise: [5, 40] }, 3000)).toBe(1);
    expect(evaluateScatterHeightBand(undefined, -100)).toBe(1);
  });

  it('decorrelates fields with a different octave offset', () => {
    const shifted = { ...field, octaveOffset: 5 };
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const x = RADIUS_M * Math.sin(i);
      const z = RADIUS_M * Math.cos(i);
      const a = evaluateScatterDensityField(field, x, i * 97, z, 200);
      const b = evaluateScatterDensityField(shifted, x, i * 97, z, 200);
      if (Math.abs(a - b) > 0.1) differ++;
    }
    expect(differ).toBeGreaterThan(40);
  });
});
