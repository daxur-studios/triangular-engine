import {
  characterVectorCross,
  characterVectorDot,
  normalizeCharacterVector3,
  type CharacterVector3,
} from './character-vector';

export interface CharacterQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function characterQuaternion(x = 0, y = 0, z = 0, w = 1): CharacterQuaternion {
  return { x, y, z, w };
}

export function characterQuaternionIdentity(): CharacterQuaternion {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/** Conjugate; equals the inverse for the unit quaternions used here. */
export function characterQuaternionConjugate(q: CharacterQuaternion): CharacterQuaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Intrinsic XYZ Euler (radians) to quaternion, matching the Three.js default order. */
export function characterQuaternionFromEuler(x: number, y: number, z: number): CharacterQuaternion {
  const cx = Math.cos(x * 0.5);
  const sx = Math.sin(x * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);
  const cz = Math.cos(z * 0.5);
  const sz = Math.sin(z * 0.5);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

export function multiplyCharacterQuaternions(
  a: CharacterQuaternion,
  b: CharacterQuaternion,
): CharacterQuaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Rotate a vector by a quaternion (v' = q · v · q⁻¹). */
export function rotateCharacterVector3(q: CharacterQuaternion, v: CharacterVector3): CharacterVector3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/** Shortest-arc unit quaternion rotating `from` onto `to` (both unit vectors). */
export function characterQuaternionFromUnitVectors(
  from: CharacterVector3,
  to: CharacterVector3,
): CharacterQuaternion {
  const d = characterVectorDot(from, to);
  if (d > 1 - 1e-8) return characterQuaternionIdentity();
  if (d < -1 + 1e-8) {
    const axis = normalizeCharacterVector3(
      characterVectorCross({ x: 1, y: 0, z: 0 }, from),
    );
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }
  const axis = normalizeCharacterVector3(characterVectorCross(from, to));
  const angle = Math.acos(d);
  const half = Math.sin(angle * 0.5);
  return { x: axis.x * half, y: axis.y * half, z: axis.z * half, w: Math.cos(angle * 0.5) };
}

/** Convert a unit quaternion back to intrinsic XYZ Euler, inverse of `characterQuaternionFromEuler`. */
export function characterQuaternionToEulerXYZ(q: CharacterQuaternion): [number, number, number] {
  const x2 = q.x + q.x;
  const y2 = q.y + q.y;
  const z2 = q.z + q.z;
  const xx = q.x * x2;
  const xy = q.x * y2;
  const xz = q.x * z2;
  const yy = q.y * y2;
  const yz = q.y * z2;
  const zz = q.z * z2;
  const wx = q.w * x2;
  const wy = q.w * y2;
  const wz = q.w * z2;

  const m11 = 1 - (yy + zz);
  const m12 = xy - wz;
  const m13 = xz + wy;
  const m22 = 1 - (xx + zz);
  const m23 = yz - wx;
  const m32 = yz + wx;
  const m33 = 1 - (xx + yy);

  const y = Math.asin(Math.min(1, Math.max(-1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m23, m33), y, Math.atan2(-m12, m11)];
  }
  return [Math.atan2(m32, m22), y, 0];
}
