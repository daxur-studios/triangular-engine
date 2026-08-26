import { fibonacciSpherePoints } from './fibonacci-sphere';
import { length } from './vec3';

describe('fibonacciSpherePoints', () => {
  it('returns exactly the requested number of points', () => {
    const points = fibonacciSpherePoints({ count: 200 });
    expect(points.length).toBe(200);
  });

  it('places every point on the unit sphere', () => {
    const points = fibonacciSpherePoints({ count: 200, seed: 7, jitter: 0.05 });
    for (const point of points) {
      expect(length(point)).toBeCloseTo(1, 9);
    }
  });

  it('is deterministic for the same seed and jittery for different seeds', () => {
    const a = fibonacciSpherePoints({ count: 50, seed: 1, jitter: 0.1 });
    const b = fibonacciSpherePoints({ count: 50, seed: 1, jitter: 0.1 });
    const c = fibonacciSpherePoints({ count: 50, seed: 2, jitter: 0.1 });

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('rejects fewer than 4 points', () => {
    expect(() => fibonacciSpherePoints({ count: 3 })).toThrow();
  });
});
