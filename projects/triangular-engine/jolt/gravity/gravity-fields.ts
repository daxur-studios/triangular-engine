import type { Vector3Tuple } from 'three';

/**
 * Gravity acceleration as a function of world position.
 *
 * Takes a world position in metres and returns the acceleration in m/s^2 that gravity has
 * at that point. Return `undefined` when the field does not apply there, which means "keep
 * the world gravity".
 */
export type JoltGravityField = (worldPositionM: Vector3Tuple) => Vector3Tuple | undefined;

/**
 * Creates a gravity field that pulls toward a sphere's centre with constant strength.
 *
 * The magnitude is `accelerationMs2` everywhere, and the direction points from the position
 * toward `centreM`. This models the space outside a planet. Interiors of hollow spheres are
 * not modelled: inside the sphere the field still points toward the centre.
 *
 * @param centreM Sphere centre in world metres.
 * @param accelerationMs2 Gravity magnitude in m/s^2.
 * @returns A field that returns the acceleration vector, or `undefined` exactly at `centreM`
 * where the direction is undefined.
 */
export function sphereGravityField(centreM: Vector3Tuple, accelerationMs2: number): JoltGravityField {
  return (worldPositionM) => {
    const dx = centreM[0] - worldPositionM[0];
    const dy = centreM[1] - worldPositionM[1];
    const dz = centreM[2] - worldPositionM[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance === 0) return undefined;
    const scale = accelerationMs2 / distance;
    return [dx * scale, dy * scale, dz * scale];
  };
}

/**
 * Creates a gravity field for a rotating-habitat cylinder, with the wall as the floor.
 *
 * The magnitude is `accelerationMs2` everywhere, and the direction points radially outward
 * from the axis, so the cylinder wall is "down". The direction is perpendicular to the axis.
 *
 * @param axisPointM Any point on the cylinder axis, in world metres.
 * @param axisDirection Direction of the axis. It does not need to be unit length, but it must
 * not be zero.
 * @param accelerationMs2 Gravity magnitude in m/s^2 at the wall or at any radius.
 * @returns A field that returns the outward acceleration vector, or `undefined` on the axis
 * where the outward direction is undefined.
 * @throws {Error} When `axisDirection` has zero length.
 */
export function cylinderGravityField(
  axisPointM: Vector3Tuple,
  axisDirection: Vector3Tuple,
  accelerationMs2: number,
): JoltGravityField {
  const axisLength = Math.hypot(axisDirection[0], axisDirection[1], axisDirection[2]);
  if (axisLength === 0) throw new Error('axisDirection must be non-zero');
  const ux = axisDirection[0] / axisLength;
  const uy = axisDirection[1] / axisLength;
  const uz = axisDirection[2] / axisLength;
  return (worldPositionM) => {
    const rx = worldPositionM[0] - axisPointM[0];
    const ry = worldPositionM[1] - axisPointM[1];
    const rz = worldPositionM[2] - axisPointM[2];
    const along = rx * ux + ry * uy + rz * uz;
    const wx = rx - along * ux;
    const wy = ry - along * uy;
    const wz = rz - along * uz;
    const radial = Math.hypot(wx, wy, wz);
    if (radial === 0) return undefined;
    const scale = accelerationMs2 / radial;
    return [wx * scale, wy * scale, wz * scale];
  };
}
