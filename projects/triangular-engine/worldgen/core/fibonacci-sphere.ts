import { createSeededRandom } from './seeded-random';
import { IVec3, normalize } from './vec3';

export interface IFibonacciSphereOptions {
  /** Point count (must be >= 4 to form a valid convex hull). */
  count: number;
  /** Seed for a small per-point angular jitter; same seed -> same jitter. */
  seed?: number;
  /** Jitter magnitude in radians applied to each point before it's re-normalized. Default 0 (pure lattice). */
  jitter?: number;
}

/**
 * Fibonacci spiral point distribution on the unit sphere — near-equal-area
 * spacing with no pole clustering. Deterministic in `count` alone; an
 * optional seeded jitter breaks the lattice's visible spiral artifacts and
 * gives distinct seeds a distinct starting layout before Lloyd relaxation.
 */
export function fibonacciSpherePoints(options: IFibonacciSphereOptions): IVec3[] {
  const { count, seed = 0, jitter = 0 } = options;
  if (count < 4) {
    throw new Error(`fibonacciSpherePoints: count must be >= 4, got ${count}`);
  }

  const random = createSeededRandom(seed);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const points: IVec3[] = [];

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    let point: IVec3 = {
      x: Math.cos(theta) * radiusAtY,
      y,
      z: Math.sin(theta) * radiusAtY,
    };

    if (jitter > 0) {
      point = {
        x: point.x + (random() - 0.5) * jitter,
        y: point.y + (random() - 0.5) * jitter,
        z: point.z + (random() - 0.5) * jitter,
      };
    }

    points.push(normalize(point));
  }

  return points;
}
