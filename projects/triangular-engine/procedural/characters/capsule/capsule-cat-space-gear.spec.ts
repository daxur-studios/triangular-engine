import { CAPSULE_CAT_PRESETS, DEFAULT_CAPSULE_CAT_DNA } from 'triangular-engine/characters';
import { buildCapsuleCatSpaceGear } from './capsule-cat-space-gear';
import { CapsuleGeometry, Mesh, SphereGeometry, TorusGeometry } from 'three';
import { catHeadScale } from './capsule-cat-shape';

describe('capsule-cat-space-gear', () => {
  it('seats each pack above the widened back across body sizes', () => {
    for (const dna of [DEFAULT_CAPSULE_CAT_DNA, ...CAPSULE_CAT_PRESETS]) {
      for (const pack of ['jetpack', 'mini_pack_brown', 'mini_pack_blue'] as const) {
        const gear = buildCapsuleCatSpaceGear({ ...dna, pack });
        const name = pack === 'jetpack' ? 'capsule-cat-jetpack-tank' : 'capsule-cat-mini-pack-body';
        const body = gear.packGroup.getObjectByName(name) as Mesh<CapsuleGeometry>;
        const cylindricalEnd = body.position.z + body.geometry.parameters.height * 0.5;
        const backHeight = dna.bodyRadius * catHeadScale(cylindricalEnd, dna.bodyRadius, dna.bodyLength);
        const bottom = body.position.y - body.geometry.parameters.radius;
        // A small overlap seats the pack without burying the tank in the body.
        expect(bottom).toBeCloseTo(backHeight - dna.bodyRadius * 0.02, 6);
        gear.dispose();
      }
    }
  });

  it('places the helmet collar at the neck and joins the bubble rim to it', () => {
    const dna = { ...DEFAULT_CAPSULE_CAT_DNA, helmet: true };
    const gear = buildCapsuleCatSpaceGear(dna);
    const collar = gear.headGearGroup.getObjectByName('capsule-cat-helmet-collar') as Mesh<TorusGeometry>;
    const dome = gear.headGearGroup.getObjectByName('capsule-cat-helmet-dome') as Mesh<SphereGeometry>;
    const neck = collar.parent!;
    const neckZ = dna.bodyLength * 0.5 - dna.bodyRadius * 0.45;
    expect(neck.position.z).toBeCloseTo(neckZ, 6);
    expect(neck.position.y).toBe(0);
    expect(neck.rotation.x).toBe(0);
    expect(collar.geometry.parameters.radius).toBeCloseTo(
      dna.bodyRadius * (catHeadScale(neckZ, dna.bodyRadius, dna.bodyLength) + 0.015), 6,
    );
    const { radius, thetaLength } = dome.geometry.parameters;
    expect(radius * Math.sin(thetaLength)).toBeCloseTo(collar.geometry.parameters.radius, 6);
    expect(dome.position.z + radius * Math.cos(thetaLength)).toBeCloseTo(0, 6);
    gear.dispose();
  });

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
