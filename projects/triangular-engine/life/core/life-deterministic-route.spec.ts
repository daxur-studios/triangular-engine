import { sampleLifeRouteAtTime, type LifeDeterministicRoute } from './life-deterministic-route';

describe('sampleLifeRouteAtTime', () => {
  const route: LifeDeterministicRoute = {
    segments: [
      { from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 }, durationSeconds: 10 },
      { from: { x: 10, y: 0, z: 0 }, to: { x: 10, y: 0, z: 10 }, durationSeconds: 10 },
    ],
  };

  it('reconstructs the same state for arbitrary time access', () => {
    const direct = sampleLifeRouteAtTime(route, 15);
    sampleLifeRouteAtTime(route, 1);
    sampleLifeRouteAtTime(route, 1000);
    const revisited = sampleLifeRouteAtTime(route, 15);
    expect(revisited).toEqual(direct);
  });

  it('clamps open routes at their endpoint', () => {
    const sample = sampleLifeRouteAtTime(route, 1000);
    expect(sample.position).toEqual({ x: 10, y: 0, z: 10 });
    expect(sample.complete).toBe(true);
  });

  it('reconstructs an activity label from the same universal-time segment', () => {
    const scheduled: LifeDeterministicRoute = {
      segments: [{
        from: { x: 0, y: 0, z: 0 },
        to: { x: 0, y: 0, z: 0 },
        durationSeconds: 8,
        activity: 'drink',
      }],
    };
    expect(sampleLifeRouteAtTime(scheduled, 4).activity).toBe('drink');
    expect(sampleLifeRouteAtTime(scheduled, 4)).toEqual(sampleLifeRouteAtTime(scheduled, 4));
  });

  it('wraps closed routes without a discontinuous state reset', () => {
    const closed = { ...route, closed: true };
    expect(sampleLifeRouteAtTime(closed, -1)).toEqual(sampleLifeRouteAtTime(closed, 19));
    expect(sampleLifeRouteAtTime(closed, 20)).toEqual(sampleLifeRouteAtTime(closed, 0));
  });
});
