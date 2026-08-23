import { Vector2, Vector3 } from 'three';

/**
 * Projection coverage for octahedral impostor baking and rendering:
 * - `'hemispherical'`: 180° upper hemisphere coverage ($y \ge 0$). Optimal texel density for ground-anchored assets (trees, flora, buildings).
 * - `'spherical'`: 360° omnidirectional sphere coverage ($x, y, z \in \mathbb{S}^2$). For airborne, space, or free-floating assets viewed from any angle.
 */
export type OctahedralImpostorType = 'hemispherical' | 'spherical';

/**
 * Maps a grid coordinate in [0,1]x[0,1] to a camera direction covering the
 * upper hemisphere (180°) — used to place bake cameras around a target object.
 * Ported from the reference three.ez octahedral-impostor library's `hemiOctaGridToDir`.
 */
export function hemiOctahedronGridToDirection(
  grid: Vector2,
  target = new Vector3(),
): Vector3 {
  target.set(grid.x - grid.y, 0, -1 + grid.x + grid.y);
  target.y = 1 - Math.abs(target.x) - Math.abs(target.z);
  return target;
}

/**
 * Maps a grid coordinate in [0,1]x[0,1] to a camera direction covering the
 * full sphere (360°) using standard octahedral mapping — used to place bake cameras
 * around free-floating, airborne, or celestial target objects.
 */
export function fullOctahedronGridToDirection(
  grid: Vector2,
  target = new Vector3(),
): Vector3 {
  const u = grid.x * 2 - 1;
  const v = grid.y * 2 - 1;
  target.set(u, 1 - Math.abs(u) - Math.abs(v), v);
  if (target.y < 0) {
    const ox = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    const oz = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
    target.x = ox;
    target.z = oz;
  }
  return target.normalize();
}
