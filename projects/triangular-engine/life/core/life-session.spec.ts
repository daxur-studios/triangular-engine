import { LifeSession } from './life-session';

describe('LifeSession', () => {
  it('advances and rewinds through an explicit universal clock', () => {
    const session = new LifeSession({ seed: 7, universalTimeSeconds: 10 });
    expect(session.advance(2.5)).toBe(12.5);
    expect(session.setUniversalTimeSeconds(3)).toBe(3);
    expect(session.snapshot()).toEqual({ seed: 7, universalTimeSeconds: 3, events: [] });
  });

  it('keeps interaction history separate from the deterministic clock', () => {
    const session = new LifeSession({ seed: 11 });
    session.events.recordDisturbance({
      id: 'vessel-1',
      center: { x: 1, y: 0, z: 2 },
      startTimeSeconds: 4,
      durationSeconds: 5,
      radius: 8,
      strength: 2,
    });
    expect(session.snapshot().events).toHaveSize(1);
    expect(session.universalTimeSeconds).toBe(0);
  });
});
