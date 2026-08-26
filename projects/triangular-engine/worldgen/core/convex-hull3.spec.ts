import { computeConvexHull3 } from './convex-hull3';
import { fibonacciSpherePoints } from './fibonacci-sphere';
import { dot } from './vec3';

describe('computeConvexHull3', () => {
  it('triangulates a regular octahedron into 8 outward-facing faces', () => {
    const points = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];

    const { faces } = computeConvexHull3(points);

    expect(faces.length).toBe(8); // 2 * 6 - 4
    for (const face of faces) {
      // Origin is strictly inside -> outward normal must point away from every one of its own vertices.
      expect(dot(face.normal, points[face.a])).toBeGreaterThan(0);
    }
  });

  it('satisfies Euler-formula face/edge counts for a larger sphere point set', () => {
    const points = fibonacciSpherePoints({ count: 150, seed: 3, jitter: 0.1 });
    const { faces } = computeConvexHull3(points);

    const expectedFaces = 2 * points.length - 4;
    expect(faces.length).toBe(expectedFaces);

    const directedEdges = new Set<string>();
    for (const face of faces) {
      directedEdges.add(`${face.a}_${face.b}`);
      directedEdges.add(`${face.b}_${face.c}`);
      directedEdges.add(`${face.c}_${face.a}`);
    }
    // Every undirected edge should appear as exactly two opposite directed edges.
    for (const key of directedEdges) {
      const [u, v] = key.split('_');
      expect(directedEdges.has(`${v}_${u}`)).toBe(true);
    }
    const undirectedEdgeCount = directedEdges.size / 2;
    expect(undirectedEdgeCount).toBe(3 * points.length - 6);
  });

  it('gives every face a non-degenerate outward normal', () => {
    const points = fibonacciSpherePoints({ count: 80, seed: 11, jitter: 0.08 });
    const { faces } = computeConvexHull3(points);

    for (const face of faces) {
      const len = Math.hypot(face.normal.x, face.normal.y, face.normal.z);
      expect(len).toBeCloseTo(1, 6);
      expect(dot(face.normal, points[face.a])).toBeGreaterThan(0);
    }
  });

  it('throws on fewer than 4 points', () => {
    expect(() =>
      computeConvexHull3([
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ]),
    ).toThrow();
  });
});
