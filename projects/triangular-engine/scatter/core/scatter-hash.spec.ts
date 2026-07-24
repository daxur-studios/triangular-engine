import { createScatterRandom01, hashScatterKey } from './scatter-hash';

describe('hashScatterKey', () => {
  it('is deterministic for the same key', () => {
    expect(hashScatterKey('cell-0-0::species-a')).toBe(
      hashScatterKey('cell-0-0::species-a'),
    );
  });

  it('differs for different keys', () => {
    expect(hashScatterKey('cell-0-0')).not.toBe(hashScatterKey('cell-0-1'));
  });

  it('always returns an unsigned 32-bit integer', () => {
    const hash = hashScatterKey('anything');
    expect(Number.isInteger(hash)).toBeTrue();
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('createScatterRandom01', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = createScatterRandom01(42);
    const b = createScatterRandom01(42);
    const sequenceA = [a(), a(), a()];
    const sequenceB = [b(), b(), b()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces values within [0, 1)', () => {
    const random = createScatterRandom01(7);
    for (let i = 0; i < 50; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createScatterRandom01(1);
    const b = createScatterRandom01(2);
    expect(a()).not.toBe(b());
  });
});
