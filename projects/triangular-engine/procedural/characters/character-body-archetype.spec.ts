import {
  CHARACTER_MAX_TRIANGLES_PER_MESH,
  DEFAULT_CHARACTER_FINGER_COUNT,
  DEFAULT_CHARACTER_MAX_TRIANGLES,
  DEFAULT_CHARACTER_RADIAL_SEGMENTS,
  validateCharacterBodyArchetype,
  validateProceduralCharacterOptions,
} from './character-body-archetype';

describe('Character Body Archetype', () => {
  it('exposes default constants', () => {
    expect(CHARACTER_MAX_TRIANGLES_PER_MESH).toBe(25_000);
    expect(DEFAULT_CHARACTER_MAX_TRIANGLES).toBe(10_000);
    expect(DEFAULT_CHARACTER_RADIAL_SEGMENTS).toBe(8);
    expect(DEFAULT_CHARACTER_FINGER_COUNT).toBe(5);
  });

  it('validates empty or undefined options without throwing', () => {
    expect(() => validateProceduralCharacterOptions(undefined)).not.toThrow();
    expect(() => validateProceduralCharacterOptions({})).not.toThrow();
  });

  it('validates valid character options', () => {
    expect(() =>
      validateProceduralCharacterOptions({
        schemaVersion: 1,
        id: 'hero-01',
        seed: 'test-seed',
        radialSegments: 8,
        fingerCount: 5,
        maxTriangles: 5000,
        roughness: 0.5,
        metalness: 0.1,
        proportions: {
          headRadius: 0.12,
          torsoLength: 0.5,
        },
        palette: {
          skin: '#e0ac69',
          torso: '#3b82f6',
        },
      }),
    ).not.toThrow();
  });

  it('validates valid character archetype', () => {
    expect(() =>
      validateCharacterBodyArchetype({
        schemaVersion: 1,
        id: 'humanoid-base',
        options: {
          radialSegments: 6,
          fingerCount: 0,
        },
      }),
    ).not.toThrow();
  });

  it('throws RangeError on invalid schemaVersion', () => {
    expect(() =>
      validateProceduralCharacterOptions({
        schemaVersion: 0 as unknown as 1,
      }),
    ).toThrowError(RangeError);

    expect(() =>
      validateCharacterBodyArchetype({
        schemaVersion: 0 as unknown as 1,
        id: 'test',
      }),
    ).toThrowError(RangeError);
  });

  it('throws RangeError on empty id', () => {
    expect(() =>
      validateProceduralCharacterOptions({
        id: '',
      }),
    ).toThrowError(RangeError);

    expect(() =>
      validateCharacterBodyArchetype({
        schemaVersion: 1,
        id: '',
      }),
    ).toThrowError(RangeError);
  });

  it('throws RangeError on invalid radialSegments', () => {
    expect(() => validateProceduralCharacterOptions({ radialSegments: 2 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ radialSegments: 100 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ radialSegments: 5.5 })).toThrowError(
      RangeError,
    );
  });

  it('throws RangeError on invalid fingerCount', () => {
    expect(() => validateProceduralCharacterOptions({ fingerCount: -1 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ fingerCount: 6 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ fingerCount: 2.5 })).toThrowError(
      RangeError,
    );
  });

  it('throws RangeError on invalid maxTriangles', () => {
    expect(() => validateProceduralCharacterOptions({ maxTriangles: 0 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ maxTriangles: -10 })).toThrowError(
      RangeError,
    );
    expect(() =>
      validateProceduralCharacterOptions({
        maxTriangles: CHARACTER_MAX_TRIANGLES_PER_MESH + 1,
      }),
    ).toThrowError(RangeError);
  });

  it('throws RangeError on invalid roughness or metalness', () => {
    expect(() => validateProceduralCharacterOptions({ roughness: -0.1 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ roughness: 1.2 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ metalness: -0.1 })).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralCharacterOptions({ metalness: 1.2 })).toThrowError(
      RangeError,
    );
  });

  it('throws RangeError on invalid proportions', () => {
    expect(() =>
      validateProceduralCharacterOptions({
        proportions: {
          headRadius: 0,
        },
      }),
    ).toThrowError(RangeError);

    expect(() =>
      validateProceduralCharacterOptions({
        proportions: {
          torsoLength: -0.5,
        },
      }),
    ).toThrowError(RangeError);

    expect(() =>
      validateProceduralCharacterOptions({
        proportions: {
          handLength: NaN,
        },
      }),
    ).toThrowError(RangeError);
  });
});
