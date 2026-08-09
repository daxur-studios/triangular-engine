/** Stable, platform-independent integer hash for simulation seeds and ids. */
export function animalHash(seed: number, value: string | number): number {
  let hash = seed | 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash | 0;
}

export function animalUnit(seed: number, value: string | number): number {
  return ((animalHash(seed, value) >>> 0) / 4294967296);
}
