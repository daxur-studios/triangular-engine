import { stepFlock } from './flock-step';

describe('stepFlock', () => {
  it('keeps animals above sampled terrain and reacts to disturbances', () => {
    const terrain = { sample: () => ({ height: 3, normal: { x: 0, y: 1, z: 0 } }) };
    const flock = [{ id: 'a', position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, activity: 'travel' as const, visible: true }];
    const next = stepFlock(flock, 1, 2, terrain, { id: 'vehicle', position: { x: 0, y: 0, z: 0 }, radius: 10, strength: 3 });
    expect(next[0].position.y).toBeGreaterThanOrEqual(3);
    expect(next[0].activity).toBe('flee');
  });
});
