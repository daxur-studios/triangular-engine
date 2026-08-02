import { ISplineDefinition } from './spline-definition';
import { evaluateAtRawParameter, getSplineSegmentCount } from './spline-evaluate';
import { lengthVec3 } from './spline-math';

function linearOpen(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'linear-open',
    interpolation: 'linear',
    closed: false,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
    ],
  };
}

function linearClosed(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'linear-closed',
    interpolation: 'linear',
    closed: true,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
    ],
  };
}

describe('getSplineSegmentCount', () => {
  it('is points.length - 1 for open splines', () => {
    expect(getSplineSegmentCount(linearOpen())).toBe(2);
  });

  it('is points.length for closed splines (includes the wrap segment)', () => {
    expect(getSplineSegmentCount(linearClosed())).toBe(3);
  });
});

describe('evaluateAtRawParameter — linear', () => {
  it('evaluates the midpoint of the first segment', () => {
    const sample = evaluateAtRawParameter(linearOpen(), 0.5);
    expect(sample.position).toEqual([5, 0, 0]);
    expect(sample.tangent).toEqual([1, 0, 0]);
  });

  it('evaluates exactly at a control point', () => {
    const sample = evaluateAtRawParameter(linearOpen(), 1);
    expect(sample.position).toEqual([10, 0, 0]);
  });

  it('clamps rawParameter at the final point for an open spline', () => {
    const segmentCount = getSplineSegmentCount(linearOpen());
    const sample = evaluateAtRawParameter(linearOpen(), segmentCount);
    expect(sample.position).toEqual([10, 0, 10]);
  });

  it('clamps out-of-range raw parameters instead of throwing', () => {
    const below = evaluateAtRawParameter(linearOpen(), -5);
    const above = evaluateAtRawParameter(linearOpen(), 999);
    expect(below.position).toEqual([0, 0, 0]);
    expect(above.position).toEqual([10, 0, 10]);
  });

  it('produces a constant tangent along one straight segment (Frenet-safe)', () => {
    const a = evaluateAtRawParameter(linearOpen(), 0.1);
    const b = evaluateAtRawParameter(linearOpen(), 0.9);
    expect(a.tangent).toEqual(b.tangent);
  });

  it('evaluates the closed wrap segment', () => {
    const def = linearClosed();
    const segmentCount = getSplineSegmentCount(def);
    const sample = evaluateAtRawParameter(def, segmentCount - 0.5);
    expect(sample.position).toEqual([5, 0, 5]);
  });

  it('rejects a non-finite raw parameter', () => {
    expect(() => evaluateAtRawParameter(linearOpen(), NaN)).toThrowError(
      RangeError,
    );
  });
});

describe('evaluateAtRawParameter — bezier', () => {
  function bezierOpen(): ISplineDefinition {
    return {
      schemaVersion: 1,
      id: 'bezier-open',
      interpolation: 'bezier',
      closed: false,
      points: [
        { position: [0, 0, 0], handleOut: [1, 0, 0] },
        { position: [3, 0, 0], handleIn: [-1, 0, 0], handleOut: [1, 0, 0] },
        { position: [6, 0, 0], handleIn: [-1, 0, 0] },
      ],
    };
  }

  it('reproduces the exact cubic Bezier position at u=0 and u=1', () => {
    const start = evaluateAtRawParameter(bezierOpen(), 0);
    const end = evaluateAtRawParameter(bezierOpen(), 1);
    expect(start.position).toEqual([0, 0, 0]);
    expect(end.position).toEqual([3, 0, 0]);
  });

  it('produces a unit tangent', () => {
    const sample = evaluateAtRawParameter(bezierOpen(), 0.5);
    expect(lengthVec3(sample.tangent)).toBeCloseTo(1, 10);
  });

  it('falls back to auto (one-third-chord) handles when none are authored', () => {
    const def: ISplineDefinition = {
      schemaVersion: 1,
      id: 'bezier-auto',
      interpolation: 'bezier',
      closed: false,
      points: [{ position: [0, 0, 0] }, { position: [9, 0, 0] }],
    };
    const sample = evaluateAtRawParameter(def, 0);
    expect(sample.position).toEqual([0, 0, 0]);
    expect(sample.tangent[0]).toBeGreaterThan(0);
  });

  it('does not throw and yields a finite unit tangent when an explicit handle is degenerate', () => {
    const def: ISplineDefinition = {
      schemaVersion: 1,
      id: 'bezier-degenerate',
      interpolation: 'bezier',
      closed: false,
      points: [
        { position: [0, 0, 0], handleOut: [0, 0, 0] },
        { position: [5, 0, 0], handleIn: [0, 0, 0] },
      ],
    };
    const sample = evaluateAtRawParameter(def, 0);
    expect(lengthVec3(sample.tangent)).toBeCloseTo(1, 6);
    expect(Number.isFinite(sample.tangent[0])).toBeTrue();
  });
});

describe('evaluateAtRawParameter — catmullRom', () => {
  it('throws, deferred to Phase 0B', () => {
    const def: ISplineDefinition = {
      schemaVersion: 1,
      id: 'cr',
      interpolation: 'catmullRom',
      closed: false,
      points: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }],
    };
    expect(() => evaluateAtRawParameter(def, 0.5)).toThrowError();
  });
});
