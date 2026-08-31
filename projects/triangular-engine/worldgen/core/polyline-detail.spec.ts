import { addFractalDetail, addFractalDetailWithFlow } from './polyline-detail';
import { length, normalize, vec3 } from './vec3';

describe('addFractalDetail', () => {
  const square = [vec3(1, 0, 0), vec3(0, 1, 0), vec3(-1, 0, 0), vec3(0, -1, 0)].map(normalize);

  it('returns the input unchanged when levels is 0', () => {
    expect(addFractalDetail(square, true, { levels: 0 })).toEqual(square);
  });

  it('leaves a path with fewer than 2 points unchanged', () => {
    const single = [square[0]];
    expect(addFractalDetail(single, false, { levels: 3 })).toEqual(single);
  });

  it('is deterministic for a given seed', () => {
    const a = addFractalDetail(square, true, { seed: 7 });
    const b = addFractalDetail(square, true, { seed: 7 });
    expect(a).toEqual(b);
  });

  it('produces a different shape for a different seed', () => {
    const a = addFractalDetail(square, true, { seed: 1 });
    const b = addFractalDetail(square, true, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('doubles the closed loop point count per level and keeps every point on the unit sphere', () => {
    const detailed = addFractalDetail(square, true, { levels: 2, seed: 3 });
    expect(detailed.length).toBe(square.length * 4);
    for (const p of detailed) {
      expect(length(p)).toBeCloseTo(1, 10);
    }
  });

  it('keeps the original start and end points of an open path fixed', () => {
    const open = square.slice(0, 3);
    const detailed = addFractalDetail(open, false, { levels: 2, seed: 4 });
    expect(detailed[0]).toEqual(open[0]);
    expect(detailed[detailed.length - 1]).toEqual(open[open.length - 1]);
  });
});

describe('addFractalDetailWithFlow', () => {
  const path = [vec3(1, 0, 0), vec3(0, 1, 0), vec3(-1, 0, 0)].map(normalize);
  const flow = [1, 2, 5];

  it('returns the input unchanged when levels is 0', () => {
    const { points, flow: outFlow } = addFractalDetailWithFlow(path, flow, false, { levels: 0 });
    expect(points).toEqual(path);
    expect(outFlow).toEqual(flow);
  });

  it('keeps points and flow the same length, index-aligned', () => {
    const { points, flow: outFlow } = addFractalDetailWithFlow(path, flow, false, { levels: 2, seed: 9 });
    expect(outFlow.length).toBe(points.length);
  });

  it('sets an inserted midpoint\'s flow to the average of its two original neighbors', () => {
    const { flow: outFlow } = addFractalDetailWithFlow(path, flow, false, { levels: 1, seed: 9 });
    expect(outFlow).toEqual([1, 1.5, 2, 3.5, 5]);
  });

  it('keeps the original start and end flow values fixed', () => {
    const { flow: outFlow } = addFractalDetailWithFlow(path, flow, false, { levels: 2, seed: 9 });
    expect(outFlow[0]).toBe(flow[0]);
    expect(outFlow[outFlow.length - 1]).toBe(flow[flow.length - 1]);
  });

  it('is deterministic for a given seed', () => {
    const a = addFractalDetailWithFlow(path, flow, false, { seed: 3 });
    const b = addFractalDetailWithFlow(path, flow, false, { seed: 3 });
    expect(a).toEqual(b);
  });
});
