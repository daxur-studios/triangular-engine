const TWO_PI = 2 * Math.PI;

/** The single angle-normalization choke point (map-view-mvp.md §4); always returns `[0, 2*pi)`. */
export function normalizeRadians(angleRad: number): number {
  let a = angleRad % TWO_PI;
  if (a < 0) a += TWO_PI;
  // Floating-point modulo of a value just under a multiple of TWO_PI can
  // round back up to exactly TWO_PI; fold that back to 0 to keep the
  // documented half-open range.
  return a >= TWO_PI ? 0 : a;
}

/** Clamps inverse-trig inputs to `[-1, 1]` — the single choke point for that guard (map-view-mvp.md §4). */
export function clampUnit(x: number): number {
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}
