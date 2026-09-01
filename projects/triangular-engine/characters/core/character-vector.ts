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
