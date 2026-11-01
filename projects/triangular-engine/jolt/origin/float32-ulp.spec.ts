import { float32UlpAt } from './float32-ulp';

describe('float32UlpAt', () => {
  it('matches the float32 spacing at the magnitudes that matter for rebasing', () => {
    expect(float32UlpAt(1e7)).toBe(1);
    expect(float32UlpAt(2e4)).toBe(2 ** -9);
    expect(float32UlpAt(6.371e6)).toBe(0.5);
  });

  it('is symmetric in sign', () => {
    expect(float32UlpAt(-1e7)).toBe(1);
  });

  it('returns the smallest subnormal step at zero', () => {
    expect(float32UlpAt(0)).toBe(2 ** -149);
  });
});
