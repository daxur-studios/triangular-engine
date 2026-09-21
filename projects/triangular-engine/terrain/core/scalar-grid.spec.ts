import { createInterpolatedScalarCache } from './scalar-grid';

describe('interpolated scalar cache', () => {
  const plane = (x: number, y: number) => x * 0.1 + y * 0.2;

  it('interpolates smoothly across former cache-block boundaries', () => {
    const cache = createInterpolatedScalarCache(4);

    expect(cache.sample(3.9, 2.5, plane)).toBeCloseTo(0.89, 8);
    expect(cache.sample(4.1, 2.5, plane)).toBeCloseTo(0.91, 8);
    expect(cache.sample(4, 2.5, plane)).toBeCloseTo(0.9, 8);
  });

  it('is deterministic regardless of sampling order', () => {
    const first = createInterpolatedScalarCache(4);
    const second = createInterpolatedScalarCache(4);
    const points = [[3.9, 2.5], [12.25, -1.75], [4.1, 2.5], [-0.2, 8.4]] as const;

    const firstValues = points.map(([x, y]) => first.sample(x, y, plane));
    const secondValues = [...points].reverse().map(([x, y]) => second.sample(x, y, plane)).reverse();

    expect(secondValues).toEqual(firstValues);
    expect(first.sampleCount).toBe(second.sampleCount);
  });

  it('keeps source evaluations bounded by the interpolation lattice', () => {
    const cache = createInterpolatedScalarCache(4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        cache.sample(x, y, plane);
      }
    }

    expect(cache.sampleCount).toBe(25);
  });
});
