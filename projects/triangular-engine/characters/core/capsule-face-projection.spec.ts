import { DEFAULT_CAPSULE_DNA } from './capsule-dna';
import { projectCapsuleFaceState } from './capsule-face-projection';
import { FacialAnimationController } from './face-controller';

describe('capsule-face-projection', () => {
  it('maps happy expression to positive D-mouth curve and raised cheek/lower lid', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('happy', 1.0, 0);
    const frame = ctrl.update(0.1);

    const proj = projectCapsuleFaceState(frame, { ...DEFAULT_CAPSULE_DNA, buckTeeth: true });
    expect(proj.mouth.mouthCurve).toBeGreaterThan(0.5);
    expect(proj.mouth.mouthOpen).toBeGreaterThan(0.2);
    expect(proj.mouth.buckTeeth).toBe(1);
    expect(proj.leftEye.lowerLidAngle).toBeGreaterThan(0.1);
  });

  it('maps fearful/sad expressions to negative D-flip curve and constricted pupils', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('fearful', 1.0, 0);
    const frame = ctrl.update(0.1);

    const proj = projectCapsuleFaceState(frame, DEFAULT_CAPSULE_DNA);
    expect(proj.mouth.mouthCurve).toBeLessThan(0);
    expect(proj.leftEye.pupilScale).toBeLessThan(DEFAULT_CAPSULE_DNA.pupilScale);
  });

  it('closes upper eyelids on blink and tilts eyebrows independently on skeptical', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('skeptical', 1.0, 0);
    ctrl.blink('left', 0.2);
    const frame = ctrl.update(0.05);

    const proj = projectCapsuleFaceState(frame, DEFAULT_CAPSULE_DNA);
    expect(proj.leftEye.upperLidAngle).toBeGreaterThan(proj.rightEye.upperLidAngle);
    expect(proj.rightBrow.heightOffset).toBeGreaterThan(proj.leftBrow.heightOffset);
  });
});
