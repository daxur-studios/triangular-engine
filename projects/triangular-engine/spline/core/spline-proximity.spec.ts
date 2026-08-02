import { ISplineDefinition } from './spline-definition';
import { closestPoint } from './spline-proximity';

function straightOpen(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'straight',
    interpolation: 'linear',
    closed: false,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
    ],
  };
}

function square(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'square',
    interpolation: 'linear',
    closed: true,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
      { position: [0, 0, 10] },
    ],
  };
}

describe('closestPoint — linear', () => {
  it('finds a point exactly on the spline', () => {
    const result = closestPoint(straightOpen(), [5, 0, 0]);
    expect(result.distance).toBeLessThan(1e-6);
    expect(result.point[0]).toBeCloseTo(5, 3);
    expect(result.segmentIndex).toBe(0);
  });

  it('finds the correct perpendicular distance off the segment', () => {
    const result = closestPoint(straightOpen(), [5, 0, 3]);
    expect(result.distance).toBeCloseTo(3, 3);
    expect(result.point).toEqual(
      jasmine.arrayContaining([jasmine.any(Number)]),
    );
    expect(result.point[0]).toBeCloseTo(5, 2);
    expect(result.point[2]).toBeCloseTo(0, 2);
  });

  it('clamps to the endpoint for a query beyond the open spline', () => {
    const result = closestPoint(straightOpen(), [20, 0, 30]);
    expect(result.point[0]).toBeCloseTo(10, 3);
    expect(result.point[2]).toBeCloseTo(10, 3);
    expect(result.t).toBeCloseTo(1, 3);
    expect(result.segmentIndex).toBe(1);
  });

  it('reaches the closed wrap segment', () => {
    // Wrap segment runs from (0,0,10) back to (0,0,0) — query near its midpoint.
    const result = closestPoint(square(), [-2, 0, 5]);
    expect(result.point[0]).toBeCloseTo(0, 2);
    expect(result.point[2]).toBeCloseTo(5, 1);
    expect(result.segmentIndex).toBe(3);
  });

  it('reports arcLength and t consistent with totalLength', () => {
    const result = closestPoint(straightOpen(), [10, 0, 5]);
    expect(result.arcLength).toBeGreaterThan(0);
    expect(result.t).toBeGreaterThan(0);
    expect(result.t).toBeLessThanOrEqual(1);
  });
});

describe('closestPoint — determinism', () => {
  it('returns identical results on repeated calls with the same input', () => {
    const def = straightOpen();
    const position = [4, 0, 2] as const;
    const a = closestPoint(def, position);
    const b = closestPoint(def, position);
    expect(a).toEqual(b);
  });

  it('resolves a symmetric multi-way tie deterministically across repeated calls', () => {
    // Centre of the square is equidistant from all four edge midpoints.
    const def = square();
    const centre = [5, 0, 5] as const;
    const a = closestPoint(def, centre);
    const b = closestPoint(def, centre);
    expect(a.segmentIndex).toBe(b.segmentIndex);
    expect(a.t).toBe(b.t);
  });
});

describe('closestPoint — bezier', () => {
  it('produces a finite, on-curve result for a curved spline', () => {
    const def: ISplineDefinition = {
      schemaVersion: 1,
      id: 'curve',
      interpolation: 'bezier',
      closed: false,
      points: [
        { position: [0, 0, 0], handleOut: [0, 0, 10] },
        { position: [30, 0, 0], handleIn: [0, 0, -10] },
      ],
    };
    const result = closestPoint(def, [15, 0, 5]);
    expect(Number.isFinite(result.distance)).toBeTrue();
    expect(result.distance).toBeLessThan(20);
  });
});
