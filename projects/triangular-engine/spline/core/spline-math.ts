/**
 * Framework-free f64 vector used throughout spline/core. Structurally
 * identical to terrain's `TerrainVector3` by design (both are field-space
 * positions) but declared locally so `spline/core` has zero import
 * dependency on any other package.
 */
export type SplineVector3 = readonly [x: number, y: number, z: number];

export function addVec3(a: SplineVector3, b: SplineVector3): SplineVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: SplineVector3, b: SplineVector3): SplineVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(a: SplineVector3, s: number): SplineVector3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dotVec3(a: SplineVector3, b: SplineVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: SplineVector3, b: SplineVector3): SplineVector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lengthVec3(a: SplineVector3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function distanceVec3(a: SplineVector3, b: SplineVector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Throws on a zero-length vector rather than returning NaN/Infinity components. */
export function normalizeVec3(a: SplineVector3): SplineVector3 {
  const length = lengthVec3(a);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError('Cannot normalize a zero-length or non-finite vector.');
  }
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function lerpVec3(
  a: SplineVector3,
  b: SplineVector3,
  t: number,
): SplineVector3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function isFiniteVec3(a: SplineVector3): boolean {
  return (
    Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2])
  );
}
