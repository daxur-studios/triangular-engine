import {
  CAPSULE_CAT_BODY_PATTERN_IDS,
  CAPSULE_CAT_GAIT_IDS,
  CAPSULE_CAT_PRESETS,
  DEFAULT_CAPSULE_CAT_DNA,
  generateCapsuleCatCharacterDNA,
  normalizeCapsuleCatCharacterDNA,
} from './capsule-cat-dna';

describe('capsule-cat-dna', () => {
  it('normalizes partial DNA and clamps out-of-range numeric parameters', () => {
    const normalized = normalizeCapsuleCatCharacterDNA({
      bodyRadius: 4,
      bodyLength: 0.01,
      eyeSpacing: 0.01,
      eyeScale: 9,
      pupilScale: 0.99,
      whiskerCount: 8,
      tailCurl: 4,
      tuft: true,
    });

    expect(normalized.bodyRadius).toBe(0.4);
    expect(normalized.bodyLength).toBe(0.24);
    expect(normalized.eyeSpacing).toBe(0.24);
    expect(normalized.eyeScale).toBe(1.35);
    expect(normalized.pupilScale).toBe(0.5);
    expect(normalized.whiskerCount).toBe(3);
    expect(normalized.tailCurl).toBe(1);
    expect(normalized.tuft).toBeTrue();
    expect(normalized.suitColor).toBe(DEFAULT_CAPSULE_CAT_DNA.suitColor);
  });

  it('drops suit booties and harness when the pattern or pack cannot support them', () => {
    const natural = normalizeCapsuleCatCharacterDNA({
      bodyPattern: 'natural_two_tone',
      suitBooties: true,
      pack: 'mini_pack_blue',
      harness: true,
    });

    expect(natural.suitBooties).toBeFalse();
    expect(natural.harness).toBeFalse();
    expect(natural.pack).toBe('mini_pack_blue');
  });

  it('produces deterministic DNA from the same seed and varied DNA across seeds', () => {
    const a1 = generateCapsuleCatCharacterDNA('space-cat');
    const a2 = generateCapsuleCatCharacterDNA('space-cat');
    const b = generateCapsuleCatCharacterDNA('cosmo-kitten');

    expect(a1).toEqual(a2);
    expect(CAPSULE_CAT_BODY_PATTERN_IDS).toContain(a1.bodyPattern);
    expect(CAPSULE_CAT_GAIT_IDS).toContain(a1.gait);
    expect(a1.bodyRadius).toBeGreaterThanOrEqual(0.16);
    expect(a1.bodyRadius).toBeLessThanOrEqual(0.4);
    expect(a1).not.toEqual(b);
  });

  it('provides all seven concept-sheet cat presets in normalized form', () => {
    expect(CAPSULE_CAT_PRESETS.length).toBe(7);
    expect(CAPSULE_CAT_PRESETS.map((preset) => preset.id)).toEqual([
      'space-cat-goofy',
      'space-kity-jetpack',
      'variant-d-caramel',
      'cosmo-kitten-a',
      'cosmo-kitten-b',
      'orbit-puffer-cat',
      'scrufly-cat',
    ]);

    for (const preset of CAPSULE_CAT_PRESETS) {
      const checked = normalizeCapsuleCatCharacterDNA(preset);
      expect(checked).toEqual(preset);
    }
  });

  it('keeps the variant-specific traits from the reference sheet', () => {
    const byId = new Map(CAPSULE_CAT_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get('space-cat-goofy')?.gait).toBe('goofy_walk');
    expect(byId.get('space-kity-jetpack')?.bodyPattern).toBe('full_suit');
    expect(byId.get('space-kity-jetpack')?.suitBooties).toBeTrue();
    expect(byId.get('variant-d-caramel')?.harness).toBeTrue();
    expect(byId.get('cosmo-kitten-a')?.pack).toBe('mini_pack_brown');
    expect(byId.get('cosmo-kitten-b')?.pack).toBe('mini_pack_blue');
    expect(byId.get('orbit-puffer-cat')?.panicked).toBeTrue();
    expect(byId.get('scrufly-cat')?.tuft).toBeTrue();
    expect(byId.get('scrufly-cat')?.restMouthPose).toBe('meow');
    expect(byId.get('scrufly-cat')?.helmet).toBeFalse();
  });
});
