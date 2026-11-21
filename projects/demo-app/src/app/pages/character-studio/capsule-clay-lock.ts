import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';

export type ClayPoint = readonly [number, number, number];
export type ClayLock = readonly [base: ClayPoint, bend: ClayPoint, tip: ClayPoint, radius: number];

/** A rounded clay strand swept along a three-point curve, local to its root. */
export function buildClayLock([base, bend, tip, radius]: ClayLock, depth = 1): TubeGeometry {
  const origin = new Vector3(...base);
  const curve = new CatmullRomCurve3([
    new Vector3(), new Vector3(...bend).sub(origin), new Vector3(...tip).sub(origin),
  ]);
  const segments = 20;
  const sides = 16;
  const geometry = new TubeGeometry(curve, segments, radius, sides);
  const positions = geometry.getAttribute('position');
  const point = new Vector3();
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments;
    const center = curve.getPointAt(t);
    const taper = Math.pow(Math.sin(Math.PI * t), .62) * (1.20 - .46 * t);
    for (let side = 0; side <= sides; side++) {
      const vertex = ring * (sides + 1) + side;
      point.fromBufferAttribute(positions, vertex).lerp(center, 1 - taper);
      positions.setXYZ(vertex, point.x, point.y, center.z + (point.z - center.z) * depth);
    }
  }
  geometry.computeVertexNormals();
  // Average the UV seam normals so the strand stays rounded under side lighting.
  const normals = geometry.getAttribute('normal');
  const seam = new Vector3();
  for (let ring = 1; ring < segments; ring++) {
    const first = ring * (sides + 1);
    const last = first + sides;
    seam.fromBufferAttribute(normals, first).add(point.fromBufferAttribute(normals, last)).normalize();
    normals.setXYZ(first, seam.x, seam.y, seam.z);
    normals.setXYZ(last, seam.x, seam.y, seam.z);
  }
  return geometry;
}
