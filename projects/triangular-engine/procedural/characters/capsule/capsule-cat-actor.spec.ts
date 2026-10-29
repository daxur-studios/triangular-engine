import { CAPSULE_CAT_PRESETS, DEFAULT_CAPSULE_CAT_DNA } from 'triangular-engine/characters';
import { CapsuleCatActor } from './capsule-cat-actor';

describe('CapsuleCatActor', () => {
  it('builds a complete four-legged procedural cat with zero-alloc Bezier legs', () => {
    const actor = new CapsuleCatActor({
      dna: {
        bodyPattern: 'front_suit',
        helmet: true,
        pack: 'jetpack',
        harness: true,
        gait: 'goofy_walk',
      },
    });

    expect(actor.root.children.length).toBe(2);
    expect(actor.dna.pack).toBe('jetpack');
    expect(actor.dna.harness).toBeTrue();
    expect(actor.locomotion).toBe('goofy_walk');

    const frontLeftGeometry = actor.frontLeftLimb.geometry;
    const frontLeftPositions = actor.frontLeftLimb.geometry.getAttribute('position').array;

    actor.setLocomotion('bound_run');
    actor.facialController.setExpression('happy', 1, 0);
    actor.update(0.1);
    actor.update(0.1);

    expect(actor.frontLeftLimb.geometry).toBe(frontLeftGeometry);
    expect(actor.frontLeftLimb.geometry.getAttribute('position').array).toBe(frontLeftPositions);
    expect(actor.latestLocomotionSample).toBeDefined();
    expect(actor.latestFaceProjection?.mouth.mouthCurve).toBeGreaterThan(0.5);

    actor.dispose();
  });

  it('builds all seven concept-sheet cats and follows their preset gait', () => {
    const actor = new CapsuleCatActor();

    for (const preset of CAPSULE_CAT_PRESETS) {
      actor.setDna(preset);
      actor.update(0.05);
      expect(actor.dna.id).toBe(preset.id);
      expect(actor.locomotion).toBe(preset.gait);
      expect(actor.latestLocomotionSample?.tail.radius).toBeGreaterThan(0);
    }

    actor.dispose();
  });

  it('switches between bare paws and suited booties with the DNA', () => {
    const actor = new CapsuleCatActor({ dna: { suitBooties: false, bodyPattern: 'front_suit' } });
    const barePaws = actor.frontLeftPaw.root.children.length;

    actor.setDna({ suitBooties: true, bodyPattern: 'full_suit' });
    const bootedPaws = actor.frontLeftPaw.root.children.length;

    expect(barePaws).toBe(bootedPaws);
    expect(actor.dna.suitBooties).toBeTrue();
    actor.dispose();
  });

  it('rebuilds limbs and paws when the body radius changes', () => {
    const actor = new CapsuleCatActor();
    const original = actor.frontLeftLimb;
    actor.setDna({ bodyRadius: 0.2, bodyLength: 0.3 });
    expect(actor.frontLeftLimb).not.toBe(original);
    expect(actor.dna.bodyRadius).toBe(0.2);
    actor.dispose();
  });

  it('normalizes a default DNA without modifiers', () => {
    expect(DEFAULT_CAPSULE_CAT_DNA.bodyPattern).toBe('front_suit');
  });

  it('updates ear 3D rotations, mouth uniforms and tail kinematics with emotions', () => {
    const actor = new CapsuleCatActor();

    // 1. Angry
    actor.facialController.setExpression('angry', 1, 0);
    actor.update(0.1);
    expect(actor.latestFaceProjection?.mouth.fangsVisible).toBeGreaterThan(0.8);
    expect(actor.catBody.uniforms.uFangsVisible.value).toBeGreaterThan(0.8);
    expect(actor.catFaceRig.leftEar.rotation.z).toBeGreaterThan(0.8); // Airplane ear roll
    expect(actor.latestLocomotionSample?.tail.radius).toBeGreaterThan(0);

    // 2. Skeptical
    actor.facialController.setExpression('skeptical', 1, 0);
    actor.update(0.1);
    expect(actor.latestFaceProjection?.mouth.mouthAsymmetry).toBeGreaterThan(0.5);
    expect(actor.catBody.uniforms.uMouthAsymmetry.value).toBeGreaterThan(0.5);

    // 3. Fearful (tail puffed & tucked)
    actor.facialController.setExpression('fearful', 1, 0);
    actor.update(0.1);
    const fearfulTailRadius = actor.latestLocomotionSample?.tail.radius ?? 0;

    // 4. Neutral
    actor.facialController.setExpression('neutral', 1, 0);
    actor.update(0.1);
    const neutralTailRadius = actor.latestLocomotionSample?.tail.radius ?? 0;
    expect(fearfulTailRadius).toBeGreaterThan(neutralTailRadius);

    actor.dispose();
  });
});
