import {
  computeScatterPhysicsAnchor,
  diffScatterPhysicsResidency,
} from './scatter-physics-residency';

describe('computeScatterPhysicsAnchor', () => {
  it('returns positionM unchanged when velocity is zero', () => {
    const anchor = computeScatterPhysicsAnchor({
      positionM: [10, 0, 0],
      velocityMps: [0, 0, 0],
      lookAheadSeconds: 2,
      maxLookAheadM: 100,
    });
    expect(anchor).toEqual([10, 0, 0]);
  });

  it('pushes the anchor along velocity by speed * lookAheadSeconds', () => {
    const anchor = computeScatterPhysicsAnchor({
      positionM: [0, 0, 0],
      velocityMps: [10, 0, 0],
      lookAheadSeconds: 2,
      maxLookAheadM: 100,
    });
    expect(anchor[0]).toBeCloseTo(20, 5);
    expect(anchor[1]).toBeCloseTo(0, 5);
    expect(anchor[2]).toBeCloseTo(0, 5);
  });

  it('clamps the look-ahead offset to maxLookAheadM without changing direction', () => {
    const anchor = computeScatterPhysicsAnchor({
      positionM: [0, 0, 0],
      velocityMps: [100, 0, 0],
      lookAheadSeconds: 5,
      maxLookAheadM: 30,
    });
    expect(anchor[0]).toBeCloseTo(30, 5);
  });

  it('handles diagonal velocity correctly', () => {
    const anchor = computeScatterPhysicsAnchor({
      positionM: [0, 0, 0],
      velocityMps: [3, 0, 4],
      lookAheadSeconds: 1,
      maxLookAheadM: 100,
    });
    expect(anchor[0]).toBeCloseTo(3, 5);
    expect(anchor[2]).toBeCloseTo(4, 5);
  });

  it('throws on non-finite input', () => {
    expect(() =>
      computeScatterPhysicsAnchor({
        positionM: [NaN, 0, 0],
        velocityMps: [0, 0, 0],
        lookAheadSeconds: 1,
        maxLookAheadM: 10,
      }),
    ).toThrowError(RangeError);
  });

  it('throws on negative lookAheadSeconds or maxLookAheadM', () => {
    expect(() =>
      computeScatterPhysicsAnchor({
        positionM: [0, 0, 0],
        velocityMps: [1, 0, 0],
        lookAheadSeconds: -1,
        maxLookAheadM: 10,
      }),
    ).toThrowError(RangeError);
  });
});

describe('diffScatterPhysicsResidency', () => {
  const baseOptions = {
    anchorWorldM: [0, 0, 0] as const,
    addRadiusM: 10,
    removeRadiusM: 15,
  };

  it('adds candidates inside addRadiusM that are not yet resident', () => {
    const result = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(),
      candidates: [
        { key: 'near', centreWorldM: [5, 0, 0] },
        { key: 'far', centreWorldM: [20, 0, 0] },
      ],
    });
    expect(result.toAdd).toEqual(['near']);
    expect(result.toRemove).toEqual([]);
    expect(result.residentKeys.has('near')).toBe(true);
    expect(result.residentKeys.has('far')).toBe(false);
  });

  it('removes resident cells once they pass removeRadiusM', () => {
    const result = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(['gone']),
      candidates: [{ key: 'gone', centreWorldM: [20, 0, 0] }],
    });
    expect(result.toRemove).toEqual(['gone']);
    expect(result.residentKeys.has('gone')).toBe(false);
  });

  it('keeps a resident cell inside the hysteresis band (between addRadiusM and removeRadiusM)', () => {
    const result = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(['band']),
      candidates: [{ key: 'band', centreWorldM: [12, 0, 0] }],
    });
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
    expect(result.residentKeys.has('band')).toBe(true);
  });

  it('does not re-add a cell already resident, even if still inside addRadiusM', () => {
    const result = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(['already']),
      candidates: [{ key: 'already', centreWorldM: [1, 0, 0] }],
    });
    expect(result.toAdd).toEqual([]);
  });

  it('removes a resident cell absent from the candidate list entirely', () => {
    const result = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(['orphan']),
      candidates: [],
    });
    expect(result.toRemove).toEqual(['orphan']);
  });

  it('produces no churn on repeated calls with an unmoving anchor', () => {
    const candidates = [{ key: 'stable', centreWorldM: [5, 0, 0] as const }];
    const first = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: new Set(),
      candidates,
    });
    const second = diffScatterPhysicsResidency({
      ...baseOptions,
      residentKeys: first.residentKeys,
      candidates,
    });
    expect(second.toAdd).toEqual([]);
    expect(second.toRemove).toEqual([]);
  });

  it('throws when removeRadiusM is not greater than addRadiusM', () => {
    expect(() =>
      diffScatterPhysicsResidency({
        anchorWorldM: [0, 0, 0],
        addRadiusM: 10,
        removeRadiusM: 10,
        residentKeys: new Set(),
        candidates: [],
      }),
    ).toThrowError(RangeError);
  });
});
