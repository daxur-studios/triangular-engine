import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  CAPSULE_ALT_CHARACTER_PRESETS,
  CAPSULE_CONCEPT_FIT_PRESETS,
  CAPSULE_CHARACTER_PRESETS,
  CAPSULE_HAIR_STYLE_IDS,
  DEFAULT_CAPSULE_DNA,
  generateCapsuleCharacterDNA,
  normalizeCapsuleCharacterDNA,
} from './capsule-dna';

describe('capsule-dna', () => {
  it('normalizes partial DNA and clamps out-of-range numeric parameters', () => {
    const normalized = normalizeCapsuleCharacterDNA({
      bodyRadius: 2.5,
      bodyHeight: 0.1,
      suitSplitY: -1.0,
      eyeSpacing: 0.01,
      pupilScale: 0.99,
      eyeSizeAsymmetry: 0.9,
      eyeHeightAsymmetry: -0.5,
      gazeAsymmetryYaw: 1.5,
      gazeAsymmetryPitch: -0.9,
      noseScale: 3.0,
      buckTeeth: true,
    });

    expect(normalized.bodyRadius).toBe(0.55);
    expect(normalized.bodyHeight).toBe(0.55);
    expect(normalized.suitSplitY).toBe(-0.25);
    expect(normalized.eyeSpacing).toBe(0.22);
    expect(normalized.pupilScale).toBe(0.55);
    expect(normalized.eyeSizeAsymmetry).toBe(0.35);
    expect(normalized.eyeHeightAsymmetry).toBe(-0.08);
    expect(normalized.gazeAsymmetryYaw).toBe(1.2);
    expect(normalized.gazeAsymmetryPitch).toBe(-0.35);
    expect(normalized.noseScale).toBe(1.4);
    expect(normalized.buckTeeth).toBeTrue();
    expect(normalized.suitColor).toBe(DEFAULT_CAPSULE_DNA.suitColor);
  });

  it('produces deterministic DNA from the same seed and varied DNA across seeds', () => {
    const a1 = generateCapsuleCharacterDNA('apollo-11');
    const a2 = generateCapsuleCharacterDNA('apollo-11');
    const b = generateCapsuleCharacterDNA('artemis-99');

    expect(a1).toEqual(a2);
    expect(CAPSULE_HAIR_STYLE_IDS).toContain(a1.hairStyleId);
    expect(a1.bodyRadius).toBeGreaterThanOrEqual(0.25);
    expect(a1.bodyRadius).toBeLessThanOrEqual(0.55);
    expect(a1).not.toEqual(b);
  });

  it('provides valid presets matching the baseline and alt Capsule Doodle concept variants', () => {
    expect(CAPSULE_CHARACTER_PRESETS.length).toBe(10);
    expect(CAPSULE_ALT_CHARACTER_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(ALL_CAPSULE_CHARACTER_PRESETS.length).toBe(
      CAPSULE_CHARACTER_PRESETS.length +
        CAPSULE_ALT_CHARACTER_PRESETS.length +
        CAPSULE_CONCEPT_FIT_PRESETS.length,
    );
    for (const preset of ALL_CAPSULE_CHARACTER_PRESETS) {
      const checked = normalizeCapsuleCharacterDNA(preset);
      expect(checked).toEqual(preset);
    }
  });
});
