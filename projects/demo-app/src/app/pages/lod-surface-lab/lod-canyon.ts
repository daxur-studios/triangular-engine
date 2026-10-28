/**
 * Plan 059 step 3b: the biome mix canyon's shape, shared by the height sampler and the canyon camera pose. Coordinates
 * are the biome strip's (u along it, v across it): u = x / sizeM on the plane, longitude / 1.8 on the sphere.
 */

/** Sideways swing of the canyon centreline, in strip units (5.5 km on the 100 km plane). */
export const CANYON_SWING = 0.055;
/** Radians of centreline phase per unit u: a bend every 26 km on the 100 km plane. */
export const CANYON_WAVE = 24;
/** Half-width of the floor in strip units (a 3 km floor on the plane). */
export const CANYON_FLOOR_HALF = 0.015;
/** Wall width in strip units: 400 m on the plane, about 4 texels of the 98 m height texture, so walls of about 66 degrees. */
export const CANYON_WALL = 0.004;
/** Plateau height above the floor as a share of the biome amplitude (900 m of 2,000 m on the plane). */
export const CANYON_DEPTH_SHARE = 0.45;

/** Cross-strip coordinate of the canyon centreline at u. */
export function canyonCentreV(u: number): number {
  return CANYON_SWING * Math.sin(CANYON_WAVE * u);
}

/** Slope dv/du of the centreline at u. */
export function canyonCentreSlope(u: number): number {
  return CANYON_SWING * CANYON_WAVE * Math.cos(CANYON_WAVE * u);
}
