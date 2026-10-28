import { CAPSULE_CHARACTER_PRESETS, CAPSULE_HAIR_STYLE_IDS } from 'triangular-engine/characters';
import { CapsuleCharacterActor } from './capsule-character-actor';

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

  it('builds allhairstyles and concept sheet presets cleanly without throwing', () => {
    const actor = new CapsuleCharacterActor();

    for (const style of CAPSULE_HAIR_STYLE_IDS) {
      actor.setDna({ hairStyleId: style });
      expect(actor.dna.hairStyleId).toBe(style);
    }

    for (const preset of CAPSULE_CHARACTER_PRESETS) {
      actor.setDna(preset);
      actor.update(0.05);
      expect(actor.dna.id).toBe(preset.id);
    }

    actor.dispose();
  });
});
