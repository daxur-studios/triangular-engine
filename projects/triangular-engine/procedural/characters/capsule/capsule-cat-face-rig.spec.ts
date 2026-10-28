import {
  CAPSULE_CAT_PRESETS,
  DEFAULT_CAPSULE_CAT_DNA,
  type CapsuleCatFaceProjection,
} from 'triangular-engine/characters';
import { buildCapsuleCatFaceRig } from './capsule-cat-face-rig';

function projection(
  overrides: Partial<CapsuleCatFaceProjection> = {},
): CapsuleCatFaceProjection {
  const eye = {
    gazeYaw: 0,
    gazePitch: 0,
    pupilScale: 0.3,
    upperLidAngle: 0,
    lowerLidAngle: 0,
    lidTiltZ: 0,
  };
  return {
    mouth: {
      mouthOpen: 0.1,
      mouthWidth: 0.6,
      mouthCurve: 0.4,
      meow: 0,
      tongueVisible: 0,
    },
    leftEye: { ...eye },
    rightEye: { ...eye },
    earPerk: 0,
    whiskerSpread: 0.3,
    ...overrides,
  };
}

describe('capsule-cat-face-rig', () => {
  it('perks and flattens both ears from the projection', () => {
    const rig = buildCapsuleCatFaceRig(DEFAULT_CAPSULE_CAT_DNA);

    rig.updateFromProjection(projection({ earPerk: 1 }));
    const perkX = rig.leftEar.rotation.x;
    rig.updateFromProjection(projection({ earPerk: -1 }));
    const flattenedX = rig.leftEar.rotation.x;

    expect(perkX).toBeGreaterThan(flattenedX);
    expect(rig.rightEar.rotation.x).toBeCloseTo(flattenedX, 5);
    rig.dispose();
  });

  it('toggles the scruffy crown tuft from DNA and live style updates', () => {
    const plain = buildCapsuleCatFaceRig(DEFAULT_CAPSULE_CAT_DNA);
    expect(plain.tuftGroup.visible).toBeFalse();
    plain.updateColorsAndStyle({ ...DEFAULT_CAPSULE_CAT_DNA, tuft: true });
    expect(plain.tuftGroup.visible).toBeTrue();
    plain.dispose();

    const scrufly = CAPSULE_CAT_PRESETS.find((preset) => preset.id === 'scrufly-cat')!;
    const rig = buildCapsuleCatFaceRig(scrufly);
    expect(rig.tuftGroup.visible).toBeTrue();
    expect(rig.leftWhiskers.visible).toBeTrue();
    rig.dispose();
  });

  it('drives eyelid pivots and whisker spread from the projection', () => {
    const rig = buildCapsuleCatFaceRig(DEFAULT_CAPSULE_CAT_DNA);
    rig.updateFromProjection(projection({ whiskerSpread: 0 }));
    const closedSpread = rig.leftWhiskers.scale.x;
    const openLid = rig.leftEye.upperLidPivot.rotation.x;

    rig.updateFromProjection(
      projection({
        whiskerSpread: 1,
        leftEye: {
          gazeYaw: 0,
          gazePitch: 0,
          pupilScale: 0.2,
          upperLidAngle: 1.2,
          lowerLidAngle: 0.4,
          lidTiltZ: 0,
        },
      }),
    );

    expect(rig.leftWhiskers.scale.x).toBeGreaterThan(closedSpread);
    expect(rig.leftEye.upperLidPivot.rotation.x).toBeGreaterThan(openLid);
    rig.dispose();
  });

  it('builds every concept-sheet cat face without throwing', () => {
    for (const preset of CAPSULE_CAT_PRESETS) {
      const rig = buildCapsuleCatFaceRig(preset);
      rig.updateFromProjection(projection());
      rig.dispose();
    }
  });
});
