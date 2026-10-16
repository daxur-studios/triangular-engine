import { cornetteShanksPhase, densityAt, rayleighPhase, sampleMedium } from './atmosphere-medium';
import { earthAtmosphereProfile } from './atmosphere-presets';

describe('atmosphere medium', () => {
  const earth = earthAtmosphereProfile();

  it('exponential density falls by e per scale height', () => {
    const d = { kind: 'exponential', scaleHeightM: 8000 } as const;
    expect(densityAt(d, 0)).toBe(1);
    expect(densityAt(d, 8000)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('tent density peaks at the centre and vanishes at the edges (Earth ozone: 10, 25, 40 km)', () => {
    const d = earth.absorbers[0].density;
    expect(densityAt(d, 25_000)).toBe(1);
    expect(densityAt(d, 10_000)).toBe(0);
    expect(densityAt(d, 40_000)).toBe(0);
    expect(densityAt(d, 17_500)).toBeCloseTo(0.5, 12);
    expect(densityAt(d, 0)).toBe(0);
    expect(densityAt(d, 55_000)).toBe(0);
  });

  it('at sea level returns the profile coefficients, and ozone adds extinction only', () => {
    const m = sampleMedium(earth, 0);
    expect(m.rayleighScattering).toEqual([5.802e-6, 13.558e-6, 33.1e-6]);
    for (let c = 0; c < 3; c++) {
      expect(m.scattering[c]).toBeCloseTo(earth.rayleigh.scatteringPerM[c] + 3.996e-6, 15);
      // no ozone at the ground, so extinction = scattering + Mie absorption
      expect(m.extinction[c]).toBeCloseTo(m.scattering[c] + 0.444e-6, 15);
    }
    const high = sampleMedium(earth, 25_000);
    expect(high.extinction[1]).toBeGreaterThan(high.scattering[1] + 1.8e-6 * 0.99);
  });

  it('is zero at and above the top of the atmosphere, and clamps below the ground', () => {
    expect(sampleMedium(earth, earth.topAltitudeM).extinction).toEqual([0, 0, 0]);
    expect(sampleMedium(earth, 1e6).scattering).toEqual([0, 0, 0]);
    expect(sampleMedium(earth, -50)).toEqual(sampleMedium(earth, 0));
  });

  function sphereIntegral(phase: (c: number) => number): number {
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += phase(-1 + (2 * (i + 0.5)) / n) * ((2 * Math.PI * 2) / n);
    return sum;
  }

  it('phase functions integrate to 1 over the sphere', () => {
    expect(sphereIntegral(rayleighPhase)).toBeCloseTo(1, 4);
    expect(sphereIntegral((c) => cornetteShanksPhase(c, 0.8))).toBeCloseTo(1, 3);
    expect(sphereIntegral((c) => cornetteShanksPhase(c, 0))).toBeCloseTo(1, 4);
  });

  it('Cornette-Shanks is forward-peaked for g > 0 and sharper for larger g', () => {
    expect(cornetteShanksPhase(1, 0.8)).toBeGreaterThan(cornetteShanksPhase(-1, 0.8) * 50);
    expect(cornetteShanksPhase(1, 0.8)).toBeGreaterThan(cornetteShanksPhase(1, 0.5));
  });
});
