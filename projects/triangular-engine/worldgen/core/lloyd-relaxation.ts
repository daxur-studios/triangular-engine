import { computeConvexHull3 } from './convex-hull3';
import { buildDualCells } from './dual-cells';
import { add, IVec3, normalize } from './vec3';

/**
 * Lloyd relaxation on the sphere: repeatedly move each site to its Voronoi
 * cell's (approximate) centroid and reproject to the unit sphere. Turns a
 * clumpy/spiral-artifact point set into a nicely irregular, evenly-spaced one.
 *
 * The centroid used per iteration is the normalized average of the cell's
 * corner directions — a cheap, good-enough stand-in for the exact spherical
 * polygon centroid for relaxation purposes.
 */
export function relaxPointsOnSphere(points: IVec3[], iterations: number): IVec3[] {
  let current = points;

  for (let iter = 0; iter < iterations; iter++) {
    const { faces } = computeConvexHull3(current);
    const { cornersByVertex } = buildDualCells(current.length, faces);

    current = current.map((site, i) => {
      const corners = cornersByVertex[i];
      if (corners.length === 0) return site;
      const sum = corners.reduce((acc, corner) => add(acc, corner), { x: 0, y: 0, z: 0 });
      return normalize(sum);
    });
  }

  return current;
}
