/** Deterministic FNV-1a 32-bit hash — stable across platforms and JS engines. */
export function hashProceduralKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG so a given seed always produces the same sequence. */
export function createProceduralRandom01(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples a value inside [min, max] deterministically from a 0..1 draw. */
export function sampleProceduralRange(
  range: readonly [number, number],
  random01: number,
): number {
  const [min, max] = range;
  return min + (max - min) * random01;
}
