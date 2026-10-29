/**
 * The orientation of a camera as three orthonormal axes, in the domain frame (doubles). Anything with these three
 * fields works, so a lab camera that also carries a position and clearance can be passed as it is.
 */
export interface CameraAxes {
  /** Unit vector to the camera's right. */
  readonly right: readonly [number, number, number];
  /** Unit vector the camera looks along. */
  readonly forward: readonly [number, number, number];
  /** Unit vector to the camera's up. */
  readonly up: readonly [number, number, number];
}

/**
 * Inward normals of the four side planes of a symmetric perspective frustum, in the layout `SelectorView.frustum`
 * expects: x, y, z for the right, left, top and bottom planes in that order (12 numbers). Every plane passes through
 * the camera. Writes into `out` and returns it; allocates nothing, so it is safe to call every frame.
 *
 * @param camera The camera's axes in the domain frame.
 * @param verticalFovRad Full vertical field of view, radians.
 * @param aspect Width over height of the view.
 * @param out A `Float64Array` of at least 12 numbers.
 */
export function frustumNormals(camera: CameraAxes, verticalFovRad: number, aspect: number, out: Float64Array): Float64Array {
  const ay = verticalFovRad / 2;
  const ax = Math.atan(Math.tan(ay) * aspect);
  // Side planes in pairs: +angle and -angle about one axis share their sine and cosine. No allocation, called every frame.
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  for (let k = 0; k < 3; k++) {
    out[k] = cx * camera.right[k] + sx * camera.forward[k];
    out[3 + k] = -cx * camera.right[k] + sx * camera.forward[k];
    out[6 + k] = cy * camera.up[k] + sy * camera.forward[k];
    out[9 + k] = -cy * camera.up[k] + sy * camera.forward[k];
  }
  return out;
}
