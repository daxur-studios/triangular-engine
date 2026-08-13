import {
  createProceduralRandom01,
  hashProceduralKey,
  sampleProceduralRange,
} from './procedural-hash';

describe('hashProceduralKey', () => {
  it('is deterministic for the same key', () => {
    expect(hashProceduralKey('oak-01')).toBe(hashProceduralKey('oak-01'));
  });

  it('differs for different keys', () => {
    expect(hashProceduralKey('oak-01')).not.toBe(hashProceduralKey('oak-02'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const hash = hashProceduralKey('a very long procedural socket key #4');
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('hashes the empty string without throwing', () => {
    expect(() => hashProceduralKey('')).not.toThrow();
  });
});

describe('createProceduralRandom01', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createProceduralRandom01(1234);
    const b = createProceduralRandom01(1234);
    const sequenceA = [a(), a(), a(), a()];
    const sequenceB = [b(), b(), b(), b()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createProceduralRandom01(1234);
    const b = createProceduralRandom01(5678);
    expect(a()).not.toBe(b());
  });

  it('stays within [0, 1)', () => {
    const random01 = createProceduralRandom01(42);
    for (let i = 0; i < 1000; i++) {
      const value = random01();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('sampleProceduralRange', () => {
  it('maps 0 to min and approaches max as random01 approaches 1', () => {
    expect(sampleProceduralRange([2, 10], 0)).toBe(2);
    expect(sampleProceduralRange([2, 10], 1)).toBe(10);
    expect(sampleProceduralRange([2, 10], 0.5)).toBe(6);
  });

  it('handles a zero-width range', () => {
    expect(sampleProceduralRange([5, 5], 0.7)).toBe(5);
  });
});
