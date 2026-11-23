import { CapsuleCrowdMotion, CROWD_COUNT, PLANTERS, PLAZA_SIZE } from './capsule-crowd-motion';
import { buildCrowdWalkPoses, WALK_FRAMES } from './capsule-crowd-poses';

describe('Capsule crowd comparison', () => {
  it('moves 256 independent agents through the same plaza while keeping them out of the planters', () => {
    const motion = new CapsuleCrowdMotion();
    const start = motion.x.slice();
    const phase = motion.phase.slice();
    for (let step = 0; step < 100; step++) motion.advance(.05);

    expect(motion.x.length).toBe(CROWD_COUNT);
    expect(motion.moving).toBeGreaterThan(200);
    expect(motion.x.filter((x, index) => Math.abs(x - start[index]) > .5).length).toBeGreaterThan(200);
    expect(motion.phase.some((value, index) => value !== phase[index])).toBeTrue();
    expect(motion.x.some((x, index) => PLANTERS.some(rect => {
      const px = x + PLAZA_SIZE / 2;
      const pz = motion.z[index] + PLAZA_SIZE / 2;
      return px > rect.x + .1 && px < rect.x + rect.width - .1 &&
        pz > rect.y + .1 && pz < rect.y + rect.height - .1;
    }))).toBeFalse();
  });

  it('uses the same topology and different vertex positions for each baked pose', () => {
    const poses = buildCrowdWalkPoses();
    try {
      expect(poses.length).toBe(WALK_FRAMES);
      expect(poses.every(pose => pose.index?.count === poses[0].index?.count)).toBeTrue();
      const first = poses[0].getAttribute('position').array;
      const quarter = poses[WALK_FRAMES / 4].getAttribute('position').array;
      expect(first).not.toEqual(quarter);
    } finally {
      for (const pose of poses) pose.dispose();
    }
  });
});
