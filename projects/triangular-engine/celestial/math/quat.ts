import { Vec3d, vec3Cross, vec3Dot } from './vec3';

/**
 * Tuple quaternion, `[x, y, z, w]`. Formulas mirror Three.js's `Quaternion`/
 * `Vector3.applyQuaternion` bit-for-bit so porting call sites at the
 * tuple/Three boundary changes no numeric behavior.
 */
export type Quatd = readonly [x: number, y: number, z: number, w: number];

export const QUAT_IDENTITY: Quatd = [0, 0, 0, 1];

export function quatLength(q: Quatd): number {
  return Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
}

export function quatNormalize(q: Quatd): Quatd {
  const len = quatLength(q);
  if (len === 0) return [0, 0, 0, 1];
  const inv = 1 / len;
  return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv];
}

export function quatConjugate(q: Quatd): Quatd {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Hamilton product `a * b` — applied to a vector, `b` rotates first, then `a`. */
export function quatMultiply(a: Quatd, b: Quatd): Quatd {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Assumes `axis` is already unit-length, matching `Quaternion.setFromAxisAngle`. */
export function quatFromAxisAngle(axis: Vec3d, angleRad: number): Quatd {
  const halfAngle = angleRad / 2;
  const s = Math.sin(halfAngle);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(halfAngle)];
}

/** Shortest rotation from unit vector `vFrom` to unit vector `vTo`; mirrors `Quaternion.setFromUnitVectors`. */
export function quatFromUnitVectors(vFrom: Vec3d, vTo: Vec3d): Quatd {
  let r = vec3Dot(vFrom, vTo) + 1;
  let x: number, y: number, z: number;

  if (r < Number.EPSILON) {
    r = 0;
    if (Math.abs(vFrom[0]) > Math.abs(vFrom[2])) {
      x = -vFrom[1];
      y = vFrom[0];
      z = 0;
    } else {
      x = 0;
      y = -vFrom[2];
      z = vFrom[1];
    }
  } else {
    const c = vec3Cross(vFrom, vTo);
    x = c[0];
    y = c[1];
    z = c[2];
  }

  return quatNormalize([x, y, z, r]);
}

export function quatApplyToVec3(q: Quatd, v: Vec3d): Vec3d {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;

  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
