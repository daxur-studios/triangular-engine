import { stepFlock } from './flock-step';
import { FlockState } from './animal-types';

describe('stepFlock', () => {
  it('keeps animals above sampled terrain and reacts to disturbances', () => {
    const terrain = { sample: () => ({ height: 3, normal: { x: 0, y: 1, z: 0 } }) };
    const flock = [{ id: 'a', position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, activity: 'travel' as const, visible: true }];
    const next = stepFlock(flock, 1, 2, terrain, { id: 'vehicle', position: { x: 0, y: 0, z: 0 }, radius: 10, strength: 3 });
    expect(next[0].position.y).toBeGreaterThanOrEqual(3);
    expect(next[0].activity).toBe('flee');
  });

  it('keeps deterministic neighbour steering finite and moves overlapping birds apart', () => {
    const terrain = { sample: () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } }) };
    const flock = [
      { id: 'a', position: { x: -0.1, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 4 }, activity: 'travel' as const, visible: true },
      { id: 'b', position: { x: 0.1, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 4 }, activity: 'travel' as const, visible: true },
    ];
    const options = { travelDirection: { x: 0, y: 0, z: 1 }, neighbourDistance: 5, steeringAcceleration: 8, turnRate: 4 };
    const first = stepFlock(flock, 0.1, 4, terrain, undefined, options);
    const second = stepFlock(flock, 0.1, 4, terrain, undefined, options);
    expect(first).toEqual(second);
    expect(Math.abs(first[0].position.x - first[1].position.x)).toBeGreaterThan(0.2);
    for (const bird of first) {
      expect(Number.isFinite(bird.position.x)).toBeTrue();
      expect(Math.hypot(bird.velocity.x, bird.velocity.z)).toBeCloseTo(4, 6);
    }
  });

  it('bounds extreme flee impulses instead of creating rocket-speed birds', () => {
    const terrain = { sample: () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } }) };
    const flock = [{ id: 'a', position: { x: 0, y: 8, z: 0 }, velocity: { x: 0, y: 0, z: 4 }, activity: 'travel' as const, visible: true }];
    const next = stepFlock(flock, 0.05, 4, terrain, { id: 'vehicle', position: { x: 0, y: 0, z: 0 }, radius: 20, strength: 1000 });
    expect(Math.hypot(next[0].velocity.x, next[0].velocity.z)).toBeLessThanOrEqual(5.000001);
  });

  it('detects a fast approaching disturbance before it overlaps', () => {
    const terrain = { sample: () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } }) };
    const flock = [{ id: 'a', position: { x: 0, y: 8, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, activity: 'travel' as const, visible: true }];
    const next = stepFlock(flock, 0.05, 4, terrain, { id: 'vehicle', position: { x: 0, y: 0, z: -30 }, velocity: { x: 0, y: 0, z: 20 }, radius: 6, strength: 2 });
    expect(next[0].activity).toBe('flee');
  });


  it('replays the same habitat trajectory from the same snapshot', () => {
    const terrain = { sample: () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } }) };
    const initial: FlockState[] = [{ id: 'a', position: { x: 2, y: 8, z: -3 }, velocity: { x: 1, y: 0, z: 3 }, activity: 'travel', visible: true }];
    const options = { origin: { x: 4, y: 0, z: -2 }, travelDirection: { x: 0.2, y: 0, z: 1 }, habitatRadius: 12 };
    const run = () => { let state = initial; for (let i = 0; i < 300; i += 1) state = stepFlock(state, 0.05, 4, terrain, undefined, options); return state; };
    expect(run()).toEqual(run());
  });
});
