export interface LifeVector3 {
  x: number;
  y: number;
  z: number;
}

export function lifeVector3(x = 0, y = 0, z = 0): LifeVector3 {
  return { x, y, z };
}

export function setLifeVector3(out: LifeVector3, x: number, y: number, z: number): LifeVector3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function addLifeVector3(out: LifeVector3, value: LifeVector3): LifeVector3 {
  out.x += value.x;
  out.y += value.y;
  out.z += value.z;
  return out;
}

export function scaleLifeVector3(out: LifeVector3, scalar: number): LifeVector3 {
  out.x *= scalar;
  out.y *= scalar;
  out.z *= scalar;
  return out;
}

export function lengthSquaredLifeVector3(value: LifeVector3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

export function normalizeLifeVector3(out: LifeVector3): LifeVector3 {
  const length = Math.sqrt(lengthSquaredLifeVector3(out));
  if (length > 1e-8) scaleLifeVector3(out, 1 / length);
  return out;
}

export function clampLifeVector3Length(out: LifeVector3, maxLength: number): LifeVector3 {
  const lengthSquared = lengthSquaredLifeVector3(out);
  if (lengthSquared > maxLength * maxLength) {
    scaleLifeVector3(out, maxLength / Math.sqrt(lengthSquared));
  }
  return out;
}
