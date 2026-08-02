import { ISplineDefinition } from './spline-definition';
import {
  buildSplineArcLengthTable,
  distanceToT,
  evaluateAtDistance,
  evaluateAtT,
  getSplineLength,
  tToDistance,
} from './spline-arc-length';
import { distanceVec3 } from './spline-math';

function straightLine(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'straight',
    interpolation: 'linear',
    closed: false,
    points: [
      { position: [0, 0, 0] },
      { position: [3, 0, 0] },
      { position: [3, 0, 4] },
    ],
  };
}

function bezierCurve(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'curve',
    interpolation: 'bezier',
    closed: false,
    points: [
      { position: [0, 0, 0], handleOut: [0, 0, 10] },
      { position: [30, 0, 0], handleIn: [0, 0, -10] },
    ],
  };
}

describe('buildSplineArcLengthTable — linear', () => {
  it('computes exact total length for straight segments', () => {
    const table = buildSplineArcLengthTable(straightLine());
    expect(table.totalLength).toBeCloseTo(3 + 4, 8);
  });

  it('is monotonically increasing in both distance and rawParameter', () => {
    const table = buildSplineArcLengthTable(straightLine());
    for (let i = 1; i < table.entries.length; i++) {
      expect(table.entries[i].distance).toBeGreaterThanOrEqual(
        table.entries[i - 1].distance,
      );
      expect(table.entries[i].rawParameter).toBeGreaterThan(
        table.entries[i - 1].rawParameter,
      );
    }
  });

  it('rawParameterAt and distanceAt are inverses at sample points', () => {
    const table = buildSplineArcLengthTable(straightLine());
    for (const distance of [0, 1, 3, 5, 7]) {
      const raw = table.rawParameterAt(distance);
      expect(table.distanceAt(raw)).toBeCloseTo(distance, 6);
    }
  });

  it('clamps distance and rawParameter queries to the valid range', () => {
    const table = buildSplineArcLengthTable(straightLine());
    expect(table.rawParameterAt(-100)).toBe(0);
    expect(table.rawParameterAt(table.totalLength + 100)).toBe(2);
  });
});

describe('arc-length monotonicity under randomised control points', () => {
  it('never produces a decreasing distance across many random splines', () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 20; trial++) {
      const pointCount = 3 + Math.floor(random() * 5);
      const points = Array.from({ length: pointCount }, () => ({
        position: [
          random() * 100,
          random() * 100,
          random() * 100,
        ] as const,
      }));
      const def: ISplineDefinition = {
        schemaVersion: 1,
        id: `random-${trial}`,
        interpolation: 'linear',
        closed: false,
        points,
      };
      const table = buildSplineArcLengthTable(def);
      for (let i = 1; i < table.entries.length; i++) {
        expect(table.entries[i].distance).toBeGreaterThanOrEqual(
          table.entries[i - 1].distance,
        );
      }
    }
  });
});

describe('evaluateAtDistance / evaluateAtT', () => {
  it('evaluateAtDistance(0) matches the start point', () => {
    const sample = evaluateAtDistance(straightLine(), 0);
    expect(sample.position).toEqual([0, 0, 0]);
  });

  it('evaluateAtDistance(totalLength) matches the end point', () => {
    const length = getSplineLength(straightLine());
    const sample = evaluateAtDistance(straightLine(), length);
    expect(distanceVec3(sample.position, [3, 0, 4])).toBeLessThan(1e-6);
  });

  it('evaluateAtT(0) and evaluateAtT(1) match the endpoints', () => {
    const def = straightLine();
    expect(evaluateAtT(def, 0).position).toEqual([0, 0, 0]);
    expect(distanceVec3(evaluateAtT(def, 1).position, [3, 0, 4])).toBeLessThan(
      1e-6,
    );
  });

  it('samples a curved spline at the midpoint distance without drifting off-curve', () => {
    const def = bezierCurve();
    const length = getSplineLength(def);
    const midSample = evaluateAtDistance(def, length / 2);
    expect(Number.isFinite(midSample.position[0])).toBeTrue();
    expect(midSample.position[0]).toBeGreaterThan(0);
    expect(midSample.position[0]).toBeLessThan(30);
  });
});

describe('distanceToT / tToDistance', () => {
  it('round-trip through both directions', () => {
    const def = straightLine();
    const length = getSplineLength(def);
    for (const distance of [0, 1, 3.5, length]) {
      const t = distanceToT(def, distance);
      expect(tToDistance(def, t)).toBeCloseTo(distance, 6);
    }
  });

  it('clamps t to [0,1]', () => {
    const def = straightLine();
    const length = getSplineLength(def);
    expect(tToDistance(def, -1)).toBe(0);
    expect(tToDistance(def, 2)).toBeCloseTo(length, 8);
  });
});
