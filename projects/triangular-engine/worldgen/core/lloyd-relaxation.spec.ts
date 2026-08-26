import { fibonacciSpherePoints } from './fibonacci-sphere';
import { relaxPointsOnSphere } from './lloyd-relaxation';
import { dot, IVec3, length } from './vec3';

function nearestNeighborAngles(points: IVec3[]): number[] {
  return points.map((p, i) => {
    let best = -1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const cosAngle = Math.min(1, Math.max(-1, dot(p, points[j])));
      const angle = Math.acos(cosAngle);
      if (best === -1 || angle < best) best = angle;
    }
    return best;
  });
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
}

describe('relaxPointsOnSphere', () => {
  it('preserves point count and keeps every point on the unit sphere', () => {
    const points = fibonacciSpherePoints({ count: 100, seed: 4, jitter: 0.3 });
    const relaxed = relaxPointsOnSphere(points, 3);

    expect(relaxed.length).toBe(points.length);
    for (const point of relaxed) {
      expect(length(point)).toBeCloseTo(1, 6);
    }
  });

  it('evens out nearest-neighbor spacing relative to a heavily jittered input', () => {
    const points = fibonacciSpherePoints({ count: 120, seed: 9, jitter: 0.4 });
    const before = variance(nearestNeighborAngles(points));

    const relaxed = relaxPointsOnSphere(points, 4);
    const after = variance(nearestNeighborAngles(relaxed));

    expect(after).toBeLessThan(before);
  });

  it('is a no-op with 0 iterations', () => {
    const points = fibonacciSpherePoints({ count: 30, seed: 1 });
    const relaxed = relaxPointsOnSphere(points, 0);
    expect(relaxed).toEqual(points);
  });
});
