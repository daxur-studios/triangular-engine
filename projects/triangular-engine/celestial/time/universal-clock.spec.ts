import { GAME_EPOCH_UT_S, UniversalClock } from './universal-clock';

describe('UniversalClock', () => {
  it('starts at the game epoch by default', () => {
    expect(new UniversalClock().nowUt).toBe(GAME_EPOCH_UT_S);
  });

  it('accepts a custom initial time', () => {
    expect(new UniversalClock(100).nowUt).toBe(100);
  });

  it('advances by exactly one fixed step per call', () => {
    const clock = new UniversalClock();
    clock.advance(1 / 240);
    clock.advance(1 / 240);
    expect(clock.nowUt).toBeCloseTo(2 / 240, 12);
  });

  it('returns the new time from advance', () => {
    const clock = new UniversalClock();
    expect(clock.advance(0.5)).toBe(0.5);
  });
});
