/**
 * Tuple 3-vector, PCI Y-up (map-view-mvp.md §3). Every function returns a
 * new tuple and never mutates an input.
 */
export type Vec3d = readonly [x: number, y: number, z: number];

export const VEC3_ZERO: Vec3d = [0, 0, 0];

export function vec3Add(a: Vec3d, b: Vec3d): Vec3d {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3d, b: Vec3d): Vec3d {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(a: Vec3d, s: number): Vec3d {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vec3Negate(a: Vec3d): Vec3d {
  return [-a[0], -a[1], -a[2]];
}

export function vec3Dot(a: Vec3d, b: Vec3d): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3d, b: Vec3d): Vec3d {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3LengthSq(a: Vec3d): number {
  return vec3Dot(a, a);
}

export function vec3Length(a: Vec3d): number {
  return Math.sqrt(vec3LengthSq(a));
}

/** Mirrors `Vector3.normalize()`'s zero-length behavior: returns the zero vector rather than NaN. */
export function vec3Normalize(a: Vec3d): Vec3d {
  const len = vec3Length(a);
  return len > 0 ? vec3Scale(a, 1 / len) : VEC3_ZERO;
}
