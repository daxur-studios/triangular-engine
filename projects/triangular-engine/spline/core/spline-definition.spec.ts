import {
  computeSplineExtent,
  ISplineDefinition,
  validateSplineDefinition,
} from './spline-definition';

function makeOpen(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'road-a',
    interpolation: 'linear',
    closed: false,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
    ],
  };
}

function makeClosed(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'island-a',
    interpolation: 'linear',
    closed: true,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
    ],
  };
}

describe('validateSplineDefinition', () => {
  it('accepts a well-formed open spline', () => {
    expect(() => validateSplineDefinition(makeOpen())).not.toThrow();
  });

  it('accepts a well-formed closed spline', () => {
    expect(() => validateSplineDefinition(makeClosed())).not.toThrow();
  });

  it('accepts the minimum legal open spline (2 points)', () => {
    const def = makeOpen();
    expect(() =>
      validateSplineDefinition({ ...def, points: def.points.slice(0, 2) }),
    ).not.toThrow();
  });

  it('rejects an open spline below the minimum point count', () => {
    const def = makeOpen();
    expect(() =>
      validateSplineDefinition({ ...def, points: def.points.slice(0, 1) }),
    ).toThrowError(RangeError);
  });

  it('accepts the minimum legal closed spline (3 points)', () => {
    expect(() => validateSplineDefinition(makeClosed())).not.toThrow();
  });

  it('rejects a closed spline below the minimum point count (degenerate two-point loop)', () => {
    const def = makeClosed();
    expect(() =>
      validateSplineDefinition({ ...def, points: def.points.slice(0, 2) }),
    ).toThrowError(RangeError);
  });

  it('rejects coincident consecutive points', () => {
    const def = makeOpen();
    expect(() =>
      validateSplineDefinition({
        ...def,
        points: [
          { position: [0, 0, 0] },
          { position: [0, 0, 0] },
          { position: [10, 0, 10] },
        ],
      }),
    ).toThrowError(RangeError);
  });

  it('rejects a coincident closing segment on a closed spline', () => {
    expect(() =>
      validateSplineDefinition({
        ...makeClosed(),
        points: [
          { position: [0, 0, 0] },
          { position: [10, 0, 0] },
          { position: [0, 0, 0] },
        ],
      }),
    ).toThrowError(RangeError);
  });

  it('rejects a non-finite position', () => {
    const def = makeOpen();
    expect(() =>
      validateSplineDefinition({
        ...def,
        points: [
          { position: [0, 0, 0] },
          { position: [NaN, 0, 0] },
          { position: [10, 0, 10] },
        ],
      }),
    ).toThrowError(RangeError);
  });

  it('rejects an unknown interpolation value', () => {
    expect(() =>
      validateSplineDefinition({
        ...makeOpen(),
        interpolation: 'quadratic' as never,
      }),
    ).toThrowError(RangeError);
  });

  it('rejects a non-positive schemaVersion', () => {
    expect(() =>
      validateSplineDefinition({ ...makeOpen(), schemaVersion: 0 }),
    ).toThrowError(RangeError);
  });

  it('rejects an empty id', () => {
    expect(() =>
      validateSplineDefinition({ ...makeOpen(), id: '' }),
    ).toThrowError(RangeError);
  });

  it('rejects a non-finite channel value', () => {
    const def = makeOpen();
    expect(() =>
      validateSplineDefinition({
        ...def,
        points: [
          { position: [0, 0, 0], channels: { widthM: NaN } },
          { position: [10, 0, 0] },
          { position: [10, 0, 10] },
        ],
      }),
    ).toThrowError(RangeError);
  });

  it('rejects an invalid channel schema entry', () => {
    expect(() =>
      validateSplineDefinition({
        ...makeOpen(),
        channelSchema: {
          widthM: { defaultValue: 1, interpolation: 'bogus' as never },
        },
      }),
    ).toThrowError(RangeError);
  });
});

describe('computeSplineExtent', () => {
  it('computes the bounding-box diagonal', () => {
    const extent = computeSplineExtent([
      { position: [0, 0, 0] },
      { position: [3, 4, 0] },
    ]);
    expect(extent).toBeCloseTo(5, 10);
  });

  it('returns 0 for an empty point list', () => {
    expect(computeSplineExtent([])).toBe(0);
  });
});
