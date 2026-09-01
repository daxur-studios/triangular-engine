import type { CharacterVector3 } from './character-vector';

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
