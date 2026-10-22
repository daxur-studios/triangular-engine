/**
 * The camera's clip planes for the bent planet lab, in world units (`planetRadius / 1000` metres, so the planet is 1000 units
 * in radius at every size).
 *
 * The sky pass rebuilds each ray as `projectionMatrixInverse * (x, y, 1, 1)` and divides by its `w`. In exact maths that `w`
 * is `1 / far`, but it is the difference of two terms of size `1 / near`, so in float32 it is lost once `far / near` passes
 * the mantissa (about 1.7e7): it reads 0 below a few hundred metres (every ray comes out as inf or NaN, a black sky) and is
 * off by a quarter at 1.7 km. The ground mesh only needs `far` out past the horizon, so the ratio is capped well inside that.
 */
export const MAX_FAR_OVER_NEAR = 1e6;

const NEAR_MIN = 1e-4;
const NEAR_MAX = 1;
const FAR_MAX = 1e5;

export function bentPlanetClipPlanes(altitudeUnits: number): { near: number; far: number } {
  const near = Math.min(NEAR_MAX, Math.max(NEAR_MIN, altitudeUnits * 0.05));
  return { near, far: Math.min(FAR_MAX, near * MAX_FAR_OVER_NEAR) };
}
