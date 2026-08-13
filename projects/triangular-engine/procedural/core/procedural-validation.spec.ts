import {
  validateProcedural01,
  validateProceduralFiniteRange,
  validateProceduralId,
  validateProceduralSchemaVersion,
  validateProceduralUniqueIds,
} from './procedural-validation';

describe('validateProceduralSchemaVersion', () => {
  it('accepts positive integers', () => {
    expect(() => validateProceduralSchemaVersion(1, 'Flora archetype')).not.toThrow();
  });

  it('rejects zero, negative, non-integer, or non-number values', () => {
    expect(() => validateProceduralSchemaVersion(0, 'Flora archetype')).toThrowError(RangeError);
    expect(() => validateProceduralSchemaVersion(-1, 'Flora archetype')).toThrowError(RangeError);
    expect(() => validateProceduralSchemaVersion(1.5, 'Flora archetype')).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralSchemaVersion('1', 'Flora archetype')).toThrowError(
      RangeError,
    );
  });
});

describe('validateProceduralId', () => {
  it('accepts a non-empty string', () => {
    expect(() => validateProceduralId('oak-01', 'Flora archetype')).not.toThrow();
  });

  it('rejects empty strings and non-strings', () => {
    expect(() => validateProceduralId('', 'Flora archetype')).toThrowError(RangeError);
    expect(() => validateProceduralId(123, 'Flora archetype')).toThrowError(RangeError);
    expect(() => validateProceduralId(undefined, 'Flora archetype')).toThrowError(RangeError);
  });
});

describe('validateProceduralFiniteRange', () => {
  it('accepts an ascending finite tuple', () => {
    expect(() => validateProceduralFiniteRange([2, 10], 'Trunk heightM')).not.toThrow();
  });

  it('accepts a zero-width range', () => {
    expect(() => validateProceduralFiniteRange([5, 5], 'Trunk heightM')).not.toThrow();
  });

  it('rejects non-arrays and wrong-length arrays', () => {
    expect(() => validateProceduralFiniteRange(5, 'Trunk heightM')).toThrowError(RangeError);
    expect(() => validateProceduralFiniteRange([1], 'Trunk heightM')).toThrowError(RangeError);
    expect(() => validateProceduralFiniteRange([1, 2, 3], 'Trunk heightM')).toThrowError(
      RangeError,
    );
  });

  it('rejects non-finite bounds', () => {
    expect(() => validateProceduralFiniteRange([NaN, 10], 'Trunk heightM')).toThrowError(
      RangeError,
    );
    expect(() => validateProceduralFiniteRange([1, Infinity], 'Trunk heightM')).toThrowError(
      RangeError,
    );
  });

  it('rejects min greater than max', () => {
    expect(() => validateProceduralFiniteRange([10, 2], 'Trunk heightM')).toThrowError(
      RangeError,
    );
  });
});

describe('validateProcedural01', () => {
  it('accepts values within [0, 1]', () => {
    expect(() => validateProcedural01(0, 'Nest cavity chance')).not.toThrow();
    expect(() => validateProcedural01(1, 'Nest cavity chance')).not.toThrow();
    expect(() => validateProcedural01(0.5, 'Nest cavity chance')).not.toThrow();
  });

  it('rejects values outside [0, 1] or non-finite values', () => {
    expect(() => validateProcedural01(-0.01, 'Nest cavity chance')).toThrowError(RangeError);
    expect(() => validateProcedural01(1.01, 'Nest cavity chance')).toThrowError(RangeError);
    expect(() => validateProcedural01(NaN, 'Nest cavity chance')).toThrowError(RangeError);
  });
});

describe('validateProceduralUniqueIds', () => {
  it('accepts a list of unique ids', () => {
    expect(() => validateProceduralUniqueIds(['a', 'b', 'c'], 'Sockets')).not.toThrow();
  });

  it('accepts an empty list', () => {
    expect(() => validateProceduralUniqueIds([], 'Sockets')).not.toThrow();
  });

  it('throws on the first duplicate id, naming it', () => {
    expect(() => validateProceduralUniqueIds(['a', 'b', 'a'], 'Sockets')).toThrowError(
      /duplicate id "a"/,
    );
  });
});
