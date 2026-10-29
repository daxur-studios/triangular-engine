import { DEFAULT_CAPSULE_DNA } from './capsule-dna';
import {
  evaluateQuadraticBezierPoint,
  evaluateQuadraticBezierTangent,
  sampleCapsuleLocomotion,
  solveRubberHoseLimb,
  stepSpringDamper3D,
} from './capsule-locomotion';
import { characterVectorDistance, characterVectorLength } from './character-vector';

describe('capsule-locomotion', () => {
  it('solves 3-point rubber-hose limb IK with predictable pole bend and unit end tangent', () => {
    const p0 = { x: 0, y: 1.0, z: 0 };
    const target = { x: 0, y: 0.55, z: 0.1 };
    const solved = solveRubberHoseLimb(p0, target, 0.6, { x: 0, y: 0, z: 1 });

    expect(solved.reached).toBeTrue();
    expect(solved.p2.x).toBeCloseTo(target.x, 4);
    expect(solved.p2.y).toBeCloseTo(target.y, 4);
    expect(solved.p2.z).toBeCloseTo(target.z, 4);
    // Mid control point arches forward (+Z) along the pole direction
    expect(solved.p1.z).toBeGreaterThan((p0.z + target.z) * 0.5);
    expect(characterVectorLength(solved.endTangent)).toBeCloseTo(1.0, 4);
  });

  it('clamps targets beyond maximum limb reach', () => {
    const p0 = { x: 0, y: 1.0, z: 0 };
    const farTarget = { x: 0, y: -2.0, z: 0 };
    const solved = solveRubberHoseLimb(p0, farTarget, 0.5, { x: 0, y: 0, z: 1 });

    expect(solved.reached).toBeFalse();
    expect(characterVectorDistance(p0, solved.p2)).toBeLessThanOrEqual(0.5);
  });

  it('evaluates quadratic Bezier endpoints and tangents accurately', () => {
    const p0 = { x: 0, y: 1, z: 0 };
    const p1 = { x: 0.2, y: 0.5, z: 0.3 };
    const p2 = { x: 0, y: 0, z: 0.1 };

    const start = evaluateQuadraticBezierPoint(p0, p1, p2, 0);
    const end = evaluateQuadraticBezierPoint(p0, p1, p2, 1);
    const tanEnd = evaluateQuadraticBezierTangent(p0, p1, p2, 1);

    expect(start).toEqual(p0);
    expect(end).toEqual(p2);
    expect(characterVectorLength(tanEnd)).toBeCloseTo(1, 5);
  });

  it('drives anti-phase foot arcs and positive body bounce during walk and run', () => {
    const walkSample = sampleCapsuleLocomotion({
      mode: 'walk',
      elapsedSeconds: 0.25,
      dna: DEFAULT_CAPSULE_DNA,
    });
    const runSample = sampleCapsuleLocomotion({
      mode: 'run',
      elapsedSeconds: 0.25,
      dna: DEFAULT_CAPSULE_DNA,
    });

    expect(walkSample.bodyBounceY).toBeGreaterThanOrEqual(0);
    expect(runSample.bodyTiltX).toBeGreaterThan(walkSample.bodyTiltX);
    // Left and right feet move in opposite Z directions
    expect(Math.sign(walkSample.leftLeg.p2.z)).toBe(-Math.sign(walkSample.rightLeg.p2.z));
  });

  it('swings the lifted foot forward (+Z) and pushes the grounded foot backward (-Z)', () => {
    // Early in the stride cycle, left foot is in swing phase (air) and right foot is in stance phase (ground)
    const early = sampleCapsuleLocomotion({
      mode: 'walk',
      elapsedSeconds: 0.08,
      dna: DEFAULT_CAPSULE_DNA,
    });
    const later = sampleCapsuleLocomotion({
      mode: 'walk',
      elapsedSeconds: 0.18,
      dna: DEFAULT_CAPSULE_DNA,
    });

    // Left foot is higher in the air and moving forward (+Z)
    expect(early.leftLeg.p2.y).toBeGreaterThan(early.rightLeg.p2.y);
    expect(later.leftLeg.p2.z).toBeGreaterThan(early.leftLeg.p2.z);

    // Right foot is on the ground pushing backward (-Z)
    expect(later.rightLeg.p2.z).toBeLessThan(early.rightLeg.p2.z);
  });

  it('supports hand action overrides (wave, point, hold_gadget)', () => {
    const waving = sampleCapsuleLocomotion({
      mode: 'idle',
      elapsedSeconds: 0.4,
      dna: DEFAULT_CAPSULE_DNA,
      rightHandAction: { mode: 'wave' },
    });
    expect(waving.rightHandPose).toBe('wave');
    expect(waving.rightArm.p2.y).toBeGreaterThan(waving.leftArm.p2.y);
  });

  it('converges 3D spring-damper secondary motion toward target', () => {
    let state = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    };
    const target = { x: 0, y: 0.05, z: -0.04 };
    for (let i = 0; i < 60; i++) {
      state = stepSpringDamper3D(state, target, 1 / 60);
    }
    expect(characterVectorDistance(state.position, target)).toBeLessThan(0.005);
  });
});
