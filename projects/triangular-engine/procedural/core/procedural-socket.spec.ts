import { deriveProceduralSocketId } from './procedural-socket';

describe('deriveProceduralSocketId', () => {
  const base = {
    archetypeId: 'oak-01',
    seed: 42,
    schemaVersion: 1,
    kind: 'perch' as const,
    ordinal: 0,
  };

  it('is deterministic for identical inputs', () => {
    expect(deriveProceduralSocketId(base)).toBe(deriveProceduralSocketId({ ...base }));
  });

  it('differs when the ordinal differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, ordinal: 1 }),
    );
  });

  it('differs when the kind differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, kind: 'fruit-slot' }),
    );
  });

  it('differs when the seed differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, seed: 43 }),
    );
  });

  it('differs when the archetypeId differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, archetypeId: 'oak-02' }),
    );
  });

  it('is prefixed with the socket kind for readability', () => {
    expect(deriveProceduralSocketId(base)).toMatch(/^perch-[0-9a-f]+$/);
  });

  it('rejects an empty archetypeId', () => {
    expect(() => deriveProceduralSocketId({ ...base, archetypeId: '' })).toThrowError(
      RangeError,
    );
  });

  it('rejects a negative or non-integer ordinal', () => {
    expect(() => deriveProceduralSocketId({ ...base, ordinal: -1 })).toThrowError(RangeError);
    expect(() => deriveProceduralSocketId({ ...base, ordinal: 1.5 })).toThrowError(RangeError);
  });
});
