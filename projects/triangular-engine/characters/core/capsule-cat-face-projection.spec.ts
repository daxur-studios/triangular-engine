import { CAPSULE_CAT_PRESETS, DEFAULT_CAPSULE_CAT_DNA } from './capsule-cat-dna';
import { projectCapsuleCatFaceState } from './capsule-cat-face-projection';
import { FacialAnimationController } from './face-controller';

describe('capsule-cat-face-projection', () => {
  it('maps happy to a positive cat-smile curve and lifted lower lids', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('happy', 1, 0);
    const frame = ctrl.update(0.1);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    expect(projection.mouth.mouthCurve).toBeGreaterThan(0.5);
    expect(projection.mouth.mouthOpen).toBeGreaterThan(0.2);
    expect(projection.leftEye.lowerLidAngle).toBeGreaterThan(0.1);
  });

  it('opens a tall meow for the Scrufly rest pose', () => {
    const ctrl = new FacialAnimationController();
    const frame = ctrl.update(0.1);
    const scrufly = CAPSULE_CAT_PRESETS.find((preset) => preset.id === 'scrufly-cat')!;

    const projection = projectCapsuleCatFaceState(frame, scrufly);
    expect(projection.mouth.meow).toBeGreaterThan(0.7);
    expect(projection.mouth.mouthOpen).toBeGreaterThan(0.4);
    expect(projection.mouth.tongueVisible).toBeGreaterThan(0);
  });

  it('closes an upper eyelid on blink while the other eye stays open', () => {
    const ctrl = new FacialAnimationController();
    ctrl.blink('left', 0.2);
    const frame = ctrl.update(0.05);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    expect(projection.leftEye.upperLidAngle).toBeGreaterThan(projection.rightEye.upperLidAngle);
  });

  it('flattens the ears and spreads the whiskers for a panicked cat', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('fearful', 1, 0);
    const frame = ctrl.update(0.1);
    const puffer = CAPSULE_CAT_PRESETS.find((preset) => preset.id === 'orbit-puffer-cat')!;

    const projection = projectCapsuleCatFaceState(frame, puffer);
    expect(projection.earPerk).toBeLessThan(0);
    expect(projection.leftEar?.pitch).toBeLessThan(-0.4);
    expect(projection.whiskerSpread).toBeGreaterThan(0.6);
    expect(projection.leftEye.pupilScale).toBeLessThan(puffer.pupilScale);
  });

  it('expresses fierce angry airplane ears, fangs and inward glare', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('angry', 1, 0);
    const frame = ctrl.update(0.1);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    // Airplane ears: flattened horizontally sideways (high roll) and swiveled
    expect(projection.leftEar?.roll).toBeGreaterThan(0.5);
    expect(projection.rightEar?.roll).toBeLessThan(-0.5);
    expect(projection.mouth.fangsVisible).toBeGreaterThan(0.8);
    expect(projection.mouth.mouthCurve).toBeLessThan(-0.5);
    expect(projection.whiskerAngle).toBeGreaterThan(0.15);
    expect(projection.leftEye.lidTiltZ).toBeLessThan(-0.3);
    expect(projection.rightEye.lidTiltZ).toBeGreaterThan(0.3);
  });

  it('expresses skeptical asymmetry across ears, eyes and mouth', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('skeptical', 1, 0);
    const frame = ctrl.update(0.1);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    // Asymmetric ears: left ear twitched sideways, right ear upright
    expect(projection.leftEar?.pitch).toBeLessThan(0);
    expect(projection.rightEar?.pitch).toBeGreaterThan(0.1);
    // Asymmetric eyes: left eye squinted glare, right eye open
    expect(projection.leftEye.upperLidAngle).toBeGreaterThan(0.4);
    expect(projection.rightEye.upperLidAngle).toBeLessThan(0.1);
    // Asymmetric smirk
    expect(projection.mouth.mouthAsymmetry).toBeGreaterThan(0.5);
  });

  it('gives disgust a downturned mouth and an asymmetric narrowed gaze', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('disgusted', 1, 0);
    const projection = projectCapsuleCatFaceState(ctrl.update(0.1), DEFAULT_CAPSULE_CAT_DNA);
    expect(projection.mouth.mouthCurve).toBeLessThan(-0.5);
    expect(projection.leftEye.upperLidAngle).toBeGreaterThan(projection.rightEye.upperLidAngle);
    expect(projection.leftEye.lidTiltZ).toBeLessThan(0);
  });

  it('expresses sad drooping ears, outward lid slant and downturned mouth', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('sad', 1, 0);
    const frame = ctrl.update(0.1);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    expect(projection.mouth.mouthCurve).toBeLessThan(-0.6);
    expect(projection.leftEar?.roll).toBeGreaterThan(0.5);
    expect(projection.rightEar?.roll).toBeLessThan(-0.5);
    expect(projection.whiskerAngle).toBeLessThan(-0.2);
    expect(projection.leftEye.lidTiltZ).toBeGreaterThan(0.2);
    expect(projection.rightEye.lidTiltZ).toBeLessThan(-0.2);
  });

  it('expresses surprised tall prick ears and wide meow mouth', () => {
    const ctrl = new FacialAnimationController();
    ctrl.setExpression('surprised', 1, 0);
    const frame = ctrl.update(0.1);

    const projection = projectCapsuleCatFaceState(frame, DEFAULT_CAPSULE_CAT_DNA);
    expect(projection.leftEar?.pitch).toBeGreaterThan(0.25);
    expect(projection.rightEar?.pitch).toBeGreaterThan(0.25);
    expect(projection.mouth.meow).toBeGreaterThan(0.7);
    expect(projection.whiskerSpread).toBeGreaterThan(0.8);
  });
});
