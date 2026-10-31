import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  CAPSULE_ACCESSORY_IDS,
  CAPSULE_CHARACTER_PRESETS,
  CAPSULE_HAIR_STYLE_IDS,
} from 'triangular-engine/characters';
import { CapsuleCharacterActor } from './capsule-character-actor';
import { CapsuleCatActor } from './capsule-cat-actor';

describe('CapsuleCharacterActor', () => {
  it('builds a complete procedural Capsule Doodle character with zero-alloc Bezier limbs', () => {
    const actor = new CapsuleCharacterActor({
      dna: {
        hairStyleId: 'pigtails',
        facialHairId: 'mustache_handlebar',
        helmet: true,
        jetpack: true,
        accessory: 'walkie_talkie',
        buckTeeth: true,
      },
    });

    expect(actor.root.children.length).toBe(2);
    expect(actor.dna.hairStyleId).toBe('pigtails');
    expect(actor.dna.buckTeeth).toBeTrue();

    // Capture geometry reference before multiple animation steps to verify zero re-allocation
    const leftLegGeoBefore = actor.leftLegMesh.geometry;
    const leftLegPosArrayBefore = actor.leftLegMesh.geometry.getAttribute('position').array;

    actor.setLocomotion('walk', 1.2);
    actor.setHandAction('right', 'wave');
    actor.facialController.setExpression('happy', 1.0, 0);
    actor.update(0.1);
    actor.update(0.1);

    expect(actor.leftLegMesh.geometry).toBe(leftLegGeoBefore);
    expect(actor.leftLegMesh.geometry.getAttribute('position').array).toBe(leftLegPosArrayBefore);
    expect(actor.latestFaceProjection?.mouth.buckTeeth).toBe(1);
    expect(actor.latestLocomotionSample?.rightHandPose).toBe('wave');

    actor.dispose();
  });

  it('builds all hairstyles, accessories, and presets cleanly without throwing', () => {
    const actor = new CapsuleCharacterActor();

    for (const style of CAPSULE_HAIR_STYLE_IDS) {
      actor.setDna({ hairStyleId: style });
      expect(actor.dna.hairStyleId).toBe(style);
    }

    for (const accessory of CAPSULE_ACCESSORY_IDS) {
      actor.setDna({ accessory });
      expect(actor.dna.accessory).toBe(accessory);
    }

    for (const preset of ALL_CAPSULE_CHARACTER_PRESETS) {
      actor.setDna(preset);
      actor.update(0.05);
      expect(actor.dna.id).toBe(preset.id);
    }
    expect(CAPSULE_CHARACTER_PRESETS.length).toBe(10);

    actor.dispose();
  });

  it('applies wonky eye size/height asymmetry and button nose scale to the face rig', () => {
    const actor = new CapsuleCharacterActor({
      dna: {
        eyeSizeAsymmetry: 0.22,
        eyeHeightAsymmetry: 0.04,
        noseScale: 0.85,
      },
    });

    expect(actor.capsuleFaceRig.noseMesh.visible).toBeTrue();
    expect(actor.capsuleFaceRig.rightEye.root.position.y).toBeGreaterThan(
      actor.capsuleFaceRig.leftEye.root.position.y,
    );

    actor.setDna({ noseScale: 0 });
    expect(actor.capsuleFaceRig.noseMesh.visible).toBeFalse();

    actor.dispose();
  });

  it('computes deterministic synthetic world bounds for shader-created mouths on human and cat capsules', () => {
    const human = new CapsuleCharacterActor();
    human.facialController.setExpression('neutral', 1, 0);
    human.update(0.1);
    const neutralBounds = human.capsuleBody.getMouthWorldBounds();
    const neutralHeight = neutralBounds.max.y - neutralBounds.min.y;

    human.facialController.setExpression('surprised', 1, 0);
    human.update(0.5);
    const surprisedBounds = human.capsuleBody.getMouthWorldBounds();
    const surprisedHeight = surprisedBounds.max.y - surprisedBounds.min.y;

    expect(surprisedHeight).toBeGreaterThan(neutralHeight);
    expect(surprisedBounds.min.y).toBeGreaterThan(1.0);
    expect(surprisedBounds.max.z).toBeGreaterThan(0.2);
    human.dispose();

    const cat = new CapsuleCatActor();
    cat.facialController.setExpression('happy', 1, 0);
    cat.update(0.2);
    const catMouthBounds = cat.catBody.getMouthWorldBounds();
    expect(catMouthBounds.max.x - catMouthBounds.min.x).toBeGreaterThan(0.05);
    expect(catMouthBounds.max.y - catMouthBounds.min.y).toBeGreaterThan(0.02);
    cat.dispose();
  });
});
