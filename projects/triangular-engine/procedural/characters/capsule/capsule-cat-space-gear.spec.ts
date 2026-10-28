import { CAPSULE_CAT_PRESETS, DEFAULT_CAPSULE_CAT_DNA } from 'triangular-engine/characters';
import { buildCapsuleCatSpaceGear } from './capsule-cat-space-gear';

describe('capsule-cat-space-gear', () => {
  it('builds the helmet, pack and harness combination requested by each preset', () => {
    for (const preset of CAPSULE_CAT_PRESETS) {
      const gear = buildCapsuleCatSpaceGear(preset);

      expect(gear.packGroup.children.length > 0).toBe(preset.pack !== 'none');
      expect(gear.headGearGroup.children.length > 0).toBe(preset.helmet);

      const harness = gear.torsoGearGroup.getObjectByName('capsule-cat-harness');
      if (preset.pack === 'jetpack' && preset.harness) {
        expect(harness).toBeDefined();
      } else {
        expect(harness).toBeUndefined();
      }

      gear.dispose();
    }
  });

  it('rebuilds the gear socket when the DNA changes', () => {
    const gear = buildCapsuleCatSpaceGear({
      ...DEFAULT_CAPSULE_CAT_DNA,
      pack: 'none',
      helmet: false,
      harness: false,
    });
    expect(gear.packGroup.children.length).toBe(0);
    expect(gear.headGearGroup.children.length).toBe(0);

    gear.updateGear({
      ...DEFAULT_CAPSULE_CAT_DNA,
      pack: 'jetpack',
      helmet: true,
      harness: true,
    });
    expect(gear.packGroup.children.length).toBeGreaterThan(0);
    expect(gear.headGearGroup.children.length).toBeGreaterThan(0);
    expect(gear.torsoGearGroup.getObjectByName('capsule-cat-harness')).toBeDefined();

    gear.updateGear({
      ...DEFAULT_CAPSULE_CAT_DNA,
      pack: 'mini_pack_blue',
      helmet: false,
      harness: false,
    });
    expect(gear.packGroup.children.length).toBeGreaterThan(0);
    expect(gear.headGearGroup.children.length).toBe(0);

    gear.dispose();
  });
});
