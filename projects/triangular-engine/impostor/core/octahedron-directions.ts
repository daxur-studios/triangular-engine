import { Vector2, Vector3 } from 'three';

/**
 * Maps a grid coordinate in [0,1]x[0,1] to a camera direction covering the
 * upper hemisphere — used to place bake cameras around a target object.
 * Ported from the reference three.ez octahedral-impostor library's
 * `hemiOctaGridToDir`. Only the hemispherical projection exists here
 * (matching what that reference itself finished, dropping its unresolved
 * full-octahedral branch): a tree/rock impostor is never viewed from below
 * the ground plane, so the upper hemisphere is all scatter ever needs.
 * The runtime inverse (direction -> grid, for picking/blending the 3
 * nearest baked views) lives in GLSL — see `impostor-shading-glsl.ts` — not
 * here, since it only ever runs on the GPU.
 */
export function hemiOctahedronGridToDirection(
  grid: Vector2,
  target = new Vector3(),
): Vector3 {
  target.set(grid.x - grid.y, 0, -1 + grid.x + grid.y);
  target.y = 1 - Math.abs(target.x) - Math.abs(target.z);
  return target;
}
