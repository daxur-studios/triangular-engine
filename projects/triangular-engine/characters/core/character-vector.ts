export interface CharacterVector3 {
  x: number;
  y: number;
  z: number;
}

export function characterVector3(x = 0, y = 0, z = 0): CharacterVector3 {
  return { x, y, z };
}

export function characterVectorLengthSquared(value: CharacterVector3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

export function characterVectorLength(value: CharacterVector3): number {
  return Math.sqrt(characterVectorLengthSquared(value));
}

export function characterVectorDistance(a: CharacterVector3, b: CharacterVector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalizeCharacterVector3(out: CharacterVector3): CharacterVector3 {
  const length = characterVectorLength(out);
  if (length > 1e-8) {
    out.x /= length;
    out.y /= length;
    out.z /= length;
  }
  return out;
}

export function characterVectorAdd(a: CharacterVector3, b: CharacterVector3): CharacterVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function characterVectorSubtract(a: CharacterVector3, b: CharacterVector3): CharacterVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function characterVectorScale(a: CharacterVector3, scale: number): CharacterVector3 {
  return { x: a.x * scale, y: a.y * scale, z: a.z * scale };
}

export function characterVectorDot(a: CharacterVector3, b: CharacterVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function characterVectorCross(a: CharacterVector3, b: CharacterVector3): CharacterVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
