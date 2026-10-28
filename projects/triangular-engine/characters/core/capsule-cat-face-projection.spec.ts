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
    expect(projection.whiskerSpread).toBeGreaterThan(0.6);
    expect(projection.leftEye.pupilScale).toBeLessThan(puffer.pupilScale);
  });
});
