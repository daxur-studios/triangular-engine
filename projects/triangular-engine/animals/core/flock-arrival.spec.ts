import { ArrivalState, stepArrival } from './flock-arrival';

const START: ArrivalState = {
  id: 'bird-1',
  position: { x: 0, y: 5, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  activity: 'seek',
};
const TARGET = { x: 10, y: 8, z: -4 };
const DEFINITION = { speed: 5, steeringAcceleration: 8, turnRate: 3, arrivalRadiusM: 4, landingDistanceM: 0.15 };

function runUntilLanded(maxSteps: number, dt = 1 / 30): ArrivalState {
  let state = START;
  for (let i = 0; i < maxSteps; i += 1) {
    state = stepArrival(state, TARGET, dt, DEFINITION);
    if (state.activity === 'landed') return state;
  }
  return state;
}

describe('stepArrival', () => {
  it('is deterministic for the same start state and step sequence', () => {
    const run = () => {
      let state = START;
      for (let i = 0; i < 200; i += 1) state = stepArrival(state, TARGET, 1 / 30, DEFINITION);
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('eventually lands and snaps position exactly to the target', () => {
    const landed = runUntilLanded(600);
    expect(landed.activity).toBe('landed');
    expect(landed.position).toEqual(TARGET);
    expect(landed.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is idempotent once landed, only accumulating activityTime', () => {
    const landed = runUntilLanded(600);
    const again = stepArrival(landed, TARGET, 1 / 30, DEFINITION);
    expect(again.position).toEqual(landed.position);
    expect(again.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(again.activity).toBe('landed');
    expect(again.activityTime).toBeCloseTo((landed.activityTime ?? 0) + 1 / 30, 6);
  });

  it('never exceeds the configured max speed while seeking', () => {
    let state = START;
    for (let i = 0; i < 400 && state.activity === 'seek'; i += 1) {
      state = stepArrival(state, TARGET, 1 / 30, DEFINITION);
      const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
      expect(speed).toBeLessThanOrEqual(DEFINITION.speed + 1e-6);
    }
  });

  it('decelerates as it enters the arrival radius', () => {
    let state = START;
    let maxSpeedFar = 0;
    for (let i = 0; i < 400; i += 1) {
      state = stepArrival(state, TARGET, 1 / 30, DEFINITION);
      const distance = Math.hypot(TARGET.x - state.position.x, TARGET.y - state.position.y, TARGET.z - state.position.z);
      const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
      // Track the cruise speed reached while still well outside the arrival radius, not the ramp-up speed from a standing start.
      if (distance > DEFINITION.arrivalRadiusM * 1.5) maxSpeedFar = Math.max(maxSpeedFar, speed);
      if (distance <= DEFINITION.arrivalRadiusM * 0.5 && state.activity === 'seek') {
        expect(maxSpeedFar).toBeGreaterThan(0);
        expect(speed).toBeLessThan(maxSpeedFar);
        return;
      }
      if (state.activity === 'landed') break;
    }
    fail('never observed the agent both far from and near the target while seeking');
  });

  it('limits the initial horizontal turn to turnRate * dt', () => {
    const facingAway: ArrivalState = { ...START, velocity: { x: 0, y: 0, z: -1 } };
    const dt = 1 / 30;
    const next = stepArrival(facingAway, TARGET, dt, DEFINITION);
    const before = Math.atan2(facingAway.velocity.x, facingAway.velocity.z);
    const after = Math.atan2(next.velocity.x, next.velocity.z);
    const turned = Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)));
    expect(turned).toBeLessThanOrEqual(DEFINITION.turnRate * dt + 1e-6);
  });

  it('keeps every value finite across a full run', () => {
    let state = START;
    for (let i = 0; i < 600; i += 1) {
      state = stepArrival(state, TARGET, 1 / 30, DEFINITION);
      expect(Number.isFinite(state.position.x)).toBeTrue();
      expect(Number.isFinite(state.position.y)).toBeTrue();
      expect(Number.isFinite(state.position.z)).toBeTrue();
      if (state.activity === 'landed') break;
    }
  });
});
