import { FixedStepClock } from './fixed-step-clock';

describe('FixedStepClock', () => {
  it('advances in fixed steps and caps catch-up work', () => {
    const clock = new FixedStepClock(1, 2);
    expect(clock.advance(10)).toEqual({ steps: 2, alpha: 0, time: 2 });
    expect(clock.advance(0.5)).toEqual({ steps: 0, alpha: 0.5, time: 2 });
  });
});
