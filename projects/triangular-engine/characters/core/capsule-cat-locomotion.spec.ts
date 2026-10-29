import { DEFAULT_CAPSULE_CAT_DNA } from './capsule-cat-dna';
import { sampleCapsuleCatLocomotion } from './capsule-cat-locomotion';
import { characterVectorDistance, characterVectorLength } from './character-vector';

describe('capsule-cat-locomotion', () => {
  it('drives a diagonal goofy trot with opposite front paw strides', () => {
    const sample = sampleCapsuleCatLocomotion({
      mode: 'goofy_walk',
      elapsedSeconds: 0.32,
      dna: DEFAULT_CAPSULE_CAT_DNA,
    });

    const leftStride = sample.frontLeft.p2.z - sample.frontLeft.p0.z;
    const rightStride = sample.frontRight.p2.z - sample.frontRight.p0.z;

    expect(sample.frontLeftPawPitch).not.toBe(sample.frontRightPawPitch);
    expect(Math.sign(leftStride)).toBe(-Math.sign(rightStride));
    expect(sample.tail.tip.y).toBeGreaterThan(sample.tail.base.y);
    expect(sample.tail.radius).toBeGreaterThan(0);
  });

  it('swings lifted paws forward (+Z) and pushes grounded paws backward (-Z)', () => {
    const early = sampleCapsuleCatLocomotion({
      mode: 'goofy_walk',
      elapsedSeconds: 0.08,
      dna: DEFAULT_CAPSULE_CAT_DNA,
    });
    const later = sampleCapsuleCatLocomotion({
      mode: 'goofy_walk',
      elapsedSeconds: 0.18,
      dna: DEFAULT_CAPSULE_CAT_DNA,
    });

    // Front-left paw is airborne and swinging forward
    expect(early.frontLeft.p2.y).toBeGreaterThan(0.07);
    expect(later.frontLeft.p2.z).toBeGreaterThan(early.frontLeft.p2.z);

    // Front-right paw is grounded and pushing backward
    expect(early.frontRight.p2.y).toBeCloseTo(0.07, 2);
    expect(later.frontRight.p2.z).toBeLessThan(early.frontRight.p2.z);
  });

  it('pitches the torso more and bounces higher during a bound than during a walk', () => {
    const walk = sampleSuspension('goofy_walk');
    const bound = sampleSuspension('bound_run');

    expect(bound.bodyTiltX).toBeGreaterThan(walk.bodyTiltX);
    expect(bound.bodyBounceY).toBeGreaterThan(walk.bodyBounceY);
    for (const leg of [bound.frontLeft, bound.frontRight, bound.backLeft, bound.backRight]) {
      expect(leg.reached).toBeTrue();
      expect(characterVectorLength(leg.endTangent)).toBeCloseTo(1, 4);
    }
  });

  it('hovers and paddles the paws in zero-G float', () => {
    const float = sampleSuspension('float');
    expect(float.bodyBounceY).toBeGreaterThan(0.15);
    // Paws lift off the ground plane while the body floats.
    expect(float.frontLeft.p2.y).toBeGreaterThan(0.1);
    expect(float.backRight.p2.y).toBeGreaterThan(0.1);
  });

  it('keeps an idle cat nearly grounded with a gentle breathing bob', () => {
    const idle = sampleSuspension('idle');
    expect(Math.abs(idle.bodyBounceY)).toBeLessThan(0.01);
    expect(idle.frontLeft.p2.y).toBeLessThan(0.09);
    expect(characterVectorDistance(idle.tail.base, idle.tail.tip)).toBeGreaterThan(0.1);
  });

  it('scales the gait phase with the speed multiplier', () => {
    const slow = sampleSuspension('goofy_walk', 0.4, 0.5);
    const fast = sampleSuspension('goofy_walk', 0.4, 2);
    expect(Math.abs(fast.phase)).toBeGreaterThan(Math.abs(slow.phase));
  });

  it('keeps the leg sockets on the rotated and lowered torso', () => {
    for (const emotion of ['neutral', 'fearful'] as const) {
      const dna = DEFAULT_CAPSULE_CAT_DNA;
      const sample = sampleCapsuleCatLocomotion({ mode: 'bound_run', elapsedSeconds: 0.37, dna, emotion });
      const x = -dna.bodyRadius * 0.56;
      const y = -dna.bodyRadius * 0.52;
      const z = dna.bodyLength * 0.28;
      const a = sample.bodyTiltX, b = sample.bodyYawY, c = sample.bodyRollZ;
      // XYZ Euler rotation matrix, followed by the rendered torso translation.
      const expectedX = Math.cos(b) * Math.cos(c) * x - Math.cos(b) * Math.sin(c) * y + Math.sin(b) * z;
      const expectedY = (Math.cos(a) * Math.sin(c) + Math.sin(a) * Math.sin(b) * Math.cos(c)) * x
        + (Math.cos(a) * Math.cos(c) - Math.sin(a) * Math.sin(b) * Math.sin(c)) * y
        - Math.sin(a) * Math.cos(b) * z;
      const expectedZ = (Math.sin(a) * Math.sin(c) - Math.cos(a) * Math.sin(b) * Math.cos(c)) * x
        + (Math.sin(a) * Math.cos(c) + Math.cos(a) * Math.sin(b) * Math.sin(c)) * y
        + Math.cos(a) * Math.cos(b) * z;
      expect(sample.frontLeft.p0.x).toBeCloseTo(expectedX + sample.bodySwayX, 6);
      expect(sample.frontLeft.p0.y).toBeCloseTo(expectedY + sample.bodyCenterY + sample.bodyBounceY, 6);
      expect(sample.frontLeft.p0.z).toBeCloseTo(expectedZ, 6);
    }
  });
});

function sampleSuspension(
  mode: 'idle' | 'goofy_walk' | 'bound_run' | 'float',
  elapsedSeconds = 0.3,
  speedMultiplier = 1,
) {
  return sampleCapsuleCatLocomotion({
    mode,
    elapsedSeconds,
    dna: DEFAULT_CAPSULE_CAT_DNA,
    speedMultiplier,
  });
}
