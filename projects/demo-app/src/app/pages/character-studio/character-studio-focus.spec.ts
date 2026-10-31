import { CapsuleCatActor, CapsuleCharacterActor } from 'triangular-engine/procedural';
import {
  fitCameraToFocusTarget,
  resolveCharacterStudioFocusTarget,
  type VisualFocusTargetId,
} from './character-studio-focus';

describe('character-studio-focus', () => {
  it('resolves composite human-face bounds including synthetic shader mouth and fits camera without clipping', () => {
    const human = new CapsuleCharacterActor({
      dna: {
        hairStyleId: 'sprout',
        eyeSizeAsymmetry: 0.22,
        eyeHeightAsymmetry: 0.04,
        noseScale: 0.9,
      },
    });
    human.facialController.setExpression('surprised', 1, 0);
    human.update(0.25);

    const target = resolveCharacterStudioFocusTarget('human-face', { humanActor: human });
    expect(target.boundsKind).toBe('composite');
    expect(target.subBounds.shaderMouth).toBeDefined();
    expect(target.subBounds.sceneGeometry).toBeDefined();

    // Ensure the composite bounds contain the bottom of the shader mouth
    const mouthBounds = target.subBounds.shaderMouth!;
    expect(target.worldBounds.min.y).toBeLessThanOrEqual(mouthBounds.min.y);

    const fit = fitCameraToFocusTarget(target, { fovDegrees: 42, aspect: 16 / 9 });
    expect(fit.inFrame).toBeTrue();
    expect(fit.occupancy).toBeGreaterThan(0.45);
    expect(fit.occupancy).toBeLessThan(0.95);
    expect(fit.shaderMouthRect).toBeDefined();
    // Mouth bottom y + height should be well above the bottom edge (1.0) of the viewport
    const mouthBottom = fit.shaderMouthRect![1] + fit.shaderMouthRect![3];
    expect(mouthBottom).toBeLessThan(0.94);

    human.dispose();
  });

  it('frames a rotated cat-face along the cat world forward normal so ears, eyes, and :3 mouth stay centered', () => {
    const cat = new CapsuleCatActor();
    cat.root.rotation.y = -0.28;
    cat.facialController.setExpression('happy', 1, 0);
    cat.update(0.25);

    const target = resolveCharacterStudioFocusTarget('cat-face', { catActor: cat });
    expect(target.forwardNormal.x).toBeLessThan(-0.15);

    const fit = fitCameraToFocusTarget(target, { fovDegrees: 42, aspect: 16 / 9 });
    expect(fit.inFrame).toBeTrue();
    expect(fit.occupancy).toBeGreaterThan(0.45);
    expect(fit.shaderMouthRect).toBeDefined();

    cat.dispose();
  });

  it('resolves all named focus target IDs cleanly', () => {
    const human = new CapsuleCharacterActor({
      dna: { hairStyleId: 'space_buns', accessory: 'coffee_mug' },
    });
    const cat = new CapsuleCatActor();
    human.update(0.2);
    cat.update(0.2);

    const targetIds: VisualFocusTargetId[] = [
      'human-face',
      'human-head-hair',
      'human-mouth',
      'human-eyes',
      'human-hand-prop',
      'human-full-body',
      'cat-face',
      'cat-mouth',
      'cat-full-body',
    ];

    for (const id of targetIds) {
      const target = resolveCharacterStudioFocusTarget(id, { humanActor: human, catActor: cat });
      const fit = fitCameraToFocusTarget(target, { fovDegrees: 42, aspect: 16 / 9 });
      expect(fit.inFrame).withContext(id).toBeTrue();
      expect(fit.projectedRect[2]).withContext(id).toBeGreaterThan(0.05);
      expect(fit.projectedRect[3]).withContext(id).toBeGreaterThan(0.05);
    }

    human.dispose();
    cat.dispose();
  });
});
