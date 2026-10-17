import { analyticDensity, distanceToBoxExit, referenceOpticalDepth } from './cloud-volume-reference';

describe('cloud volume CPU reference', () => {
  const size = [200, 100, 200] as const;

  it('box optical depth is extinction times the path to the exit', () => {
    const sun = [0, 1, 0] as const;
    const od = referenceOpticalDepth('box', [0.5, 0.25, 0.5], sun, size, 0.02);
    expect(od).toBeCloseTo(0.02 * 75, 6);
  });

  it('measures the exit distance along a slanted direction', () => {
    const s = Math.SQRT1_2;
    // From the centre toward +x +y at 45 degrees, the top face (50 m up) is hit first.
    expect(distanceToBoxExit([0.5, 0.5, 0.5], [s, s, 0], size)).toBeCloseTo(50 / s, 6);
  });

  it('blob density peaks at the centre and falls off', () => {
    expect(analyticDensity('blob', [0.5, 0.5, 0.5])).toBeCloseTo(1, 12);
    expect(analyticDensity('blob', [0.8, 0.5, 0.5])).toBeCloseTo(Math.exp(-2), 6);
  });

  it('blob optical depth through the centre matches the closed-form erf integral', () => {
    // Along +y from the centre: integral of exp(-t^2 / (2 s^2)) dt from 0 to half height, s = 0.15 * 100 m.
    const sigma = 0.15 * size[1];
    const od = referenceOpticalDepth('blob', [0.5, 0.5, 0.5], [0, 1, 0], size, 1, 4000);
    const half = 50;
    // erf(x) via a series is overkill: compare with a trapezoid on a very fine grid instead.
    let sum = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * half) / n;
      sum += Math.exp(-(t * t) / (2 * sigma * sigma));
    }
    expect(od).toBeCloseTo((sum * half) / n, 3);
  });
});
