/**
 * Modular Space Gear kit for the Capsule Doodle Space Cats:
 * - Angled bubble helmet with a dark metallic neck collar, sized around the ears
 *   and whiskers
 * - Dorsal pet jetpack: a horizontal orange cylinder with a rear nozzle cone, a
 *   grey side telemetry box with two indicator dots, and orange chest/belly harness
 *   straps wrapping the torso
 * - Compact mini saddle packs (brown / slate blue) for the Cosmo Kitten variants
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { CapsuleCatCharacterDNA, CapsuleCatPackId } from 'triangular-engine/characters';

export interface CapsuleCatSpaceGearResult {
  readonly torsoGearGroup: Group;
  readonly headGearGroup: Group;
  readonly packGroup: Group;
  readonly updateGear: (dna: CapsuleCatCharacterDNA) => void;
  readonly dispose: () => void;
}

function buildBubbleHelmet(
  r: number,
  length: number,
  darkMat: MeshStandardMaterial,
  glassMat: MeshPhysicalMaterial,
): { dome: Group; collar: Mesh } {
  const dome = new Group();
  dome.name = 'capsule-cat-bubble-helmet';
  dome.position.set(0, r * 0.18, length * 0.5 + r * 0.55);

  const domeRadius = r * 1.55;
  const glass = new Mesh(new SphereGeometry(domeRadius, 32, 24), glassMat);
  glass.renderOrder = 2;
  dome.add(glass);

  const collarGeo = new TorusGeometry(r * 1.42, r * 0.09, 12, 32);
  const collar = new Mesh(collarGeo, darkMat);
  collar.position.set(0, r * 0.02, length * 0.5);
  collar.rotation.x = -0.12;
  collar.rotation.z = 0.04;
  collar.castShadow = true;

  return { dome, collar };
}

function buildPetJetpack(
  r: number,
  length: number,
  orangeMat: MeshStandardMaterial,
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
): Group {
  const pack = new Group();
  pack.name = 'capsule-cat-pet-jetpack';
  const y = r * 0.95;
  const z = -length * 0.05;

  const tankLength = length * 0.7;
  const tankRadius = r * 0.32;
  const tankGeo = new CapsuleGeometry(tankRadius, tankLength, 12, 20);
  tankGeo.rotateX(Math.PI * 0.5);
  const tank = new Mesh(tankGeo, orangeMat);
  tank.position.set(0, y, z);
  tank.castShadow = true;
  tank.receiveShadow = true;
  pack.add(tank);

  // Rear flared nozzle cone.
  const nozzleGeo = new CylinderGeometry(tankRadius * 1.05, tankRadius * 0.7, r * 0.3, 18);
  nozzleGeo.rotateX(-Math.PI * 0.5);
  const nozzle = new Mesh(nozzleGeo, greyMat);
  nozzle.position.set(0, y, z - tankLength * 0.5 - tankRadius - r * 0.1);
  nozzle.castShadow = true;
  pack.add(nozzle);

  // Top intake pipe.
  const pipeGeo = new CapsuleGeometry(tankRadius * 0.25, r * 0.3, 8, 12);
  pipeGeo.rotateZ(Math.PI * 0.5);
  const pipe = new Mesh(pipeGeo, greyMat);
  pipe.position.set(0, y + tankRadius + r * 0.12, z + tankLength * 0.1);
  pipe.castShadow = true;
  pack.add(pipe);

  // Grey side telemetry box with two indicator dots.
  const boxGeo = new BoxGeometry(r * 0.2, r * 0.24, tankLength * 0.48);
  const box = new Mesh(boxGeo, greyMat);
  box.position.set(-(tankRadius + r * 0.14), y, z);
  box.castShadow = true;
  pack.add(box);

  const dotGeo = new SphereGeometry(r * 0.045, 8, 8);
  const dot1 = new Mesh(dotGeo, darkMat);
  dot1.position.set(-(tankRadius + r * 0.25), y + r * 0.06, z + r * 0.06);
  const dot2 = new Mesh(dotGeo, orangeMat);
  dot2.position.set(-(tankRadius + r * 0.25), y - r * 0.06, z - r * 0.06);
  pack.add(dot1, dot2);

  return pack;
}

function buildHarness(
  r: number,
  length: number,
  orangeMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
): Group {
  const harness = new Group();
  harness.name = 'capsule-cat-harness';
  const chestZ = length * 0.2;
  const bellyZ = -length * 0.12;

  for (const z of [chestZ, bellyZ]) {
    const ringGeo = new TorusGeometry(r * 1.03, r * 0.045, 10, 40);
    const ring = new Mesh(ringGeo, orangeMat);
    ring.position.set(0, 0, z);
    ring.castShadow = true;
    harness.add(ring);

    const buckleGeo = new BoxGeometry(r * 0.16, r * 0.1, r * 0.1);
    const buckle = new Mesh(buckleGeo, darkMat);
    buckle.position.set(0, r * 1.02, z);
    harness.add(buckle);
  }

  // Dorsal connector strap from the chest ring to the jetpack.
  const packZ = -length * 0.05;
  const connectorGeo = new BoxGeometry(r * 0.12, r * 0.06, chestZ - packZ + r * 0.2);
  const connector = new Mesh(connectorGeo, orangeMat);
  connector.position.set(0, r * 1.0, (chestZ + packZ) * 0.5);
  connector.castShadow = true;
  harness.add(connector);

  return harness;
}

function buildMiniPack(
  r: number,
  length: number,
  packId: CapsuleCatPackId,
  packMat: MeshStandardMaterial,
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
): Group {
  const pack = new Group();
  pack.name = packId === 'mini_pack_blue' ? 'capsule-cat-mini-pack-blue' : 'capsule-cat-mini-pack-brown';
  const y = r * 0.98;
  const z = -length * 0.02;

  if (packId === 'mini_pack_brown') {
    packMat.color.set('#8a5a3b');
  } else {
    packMat.color.set('#5b7aa8');
  }

  const bodyGeo = new CapsuleGeometry(r * 0.3, length * 0.26, 10, 16);
  bodyGeo.rotateX(Math.PI * 0.5);
  const body = new Mesh(bodyGeo, packMat);
  body.position.set(0, y, z);
  body.castShadow = true;
  body.receiveShadow = true;
  pack.add(body);

  const flapGeo = new SphereGeometry(r * 0.31, 16, 12);
  flapGeo.scale(1.12, 0.48, 1.12);
  const flap = new Mesh(flapGeo, packMat);
  flap.position.set(0, y + r * 0.2, z);
  flap.castShadow = true;
  pack.add(flap);

  const buckleGeo = new BoxGeometry(r * 0.1, r * 0.07, r * 0.08);
  const buckle = new Mesh(buckleGeo, greyMat);
  buckle.position.set(0, y + r * 0.18, z + length * 0.16);
  pack.add(buckle);

  const strapGeo = new TorusGeometry(r * 1.02, r * 0.035, 8, 32);
  const strap = new Mesh(strapGeo, darkMat);
  strap.position.set(0, 0, z);
  strap.castShadow = true;
  pack.add(strap);

  return pack;
}

/**
 * Builds the complete modular cat space gear kit for a given DNA.
 */
export function buildCapsuleCatSpaceGear(dna: CapsuleCatCharacterDNA): CapsuleCatSpaceGearResult {
  const torsoGearGroup = new Group();
  torsoGearGroup.name = 'capsule-cat-torso-gear';

  const packGroup = new Group();
  packGroup.name = 'capsule-cat-pack-socket';
  torsoGearGroup.add(packGroup);

  const headGearGroup = new Group();
  headGearGroup.name = 'capsule-cat-head-gear';

  const orangeMat = new MeshStandardMaterial({
    color: new Color(dna.suitTrimColor),
    roughness: 0.42,
    metalness: 0.12,
  });
  const greyMat = new MeshStandardMaterial({
    color: new Color('#9ca3af'),
    roughness: 0.48,
    metalness: 0.25,
  });
  const darkMat = new MeshStandardMaterial({
    color: new Color('#36393f'),
    roughness: 0.55,
    metalness: 0.2,
  });
  const packMat = new MeshStandardMaterial({
    color: new Color('#8a5a3b'),
    roughness: 0.62,
    metalness: 0.04,
  });
  const glassMat = new MeshPhysicalMaterial({
    color: new Color('#e0f2fe'),
    transparent: true,
    opacity: 0.3,
    roughness: 0.08,
    metalness: 0.05,
    reflectivity: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    depthWrite: false,
  });

  const clearChildren = (group: Group, preserve?: Group): void => {
    for (const child of [...group.children]) {
      if (child === preserve) continue;
      child.traverse((obj) => {
        const mesh = obj as Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      group.remove(child);
    }
  };

  const updateGear = (nextDna: CapsuleCatCharacterDNA): void => {
    orangeMat.color.set(nextDna.suitTrimColor);

    clearChildren(torsoGearGroup, packGroup);
    clearChildren(packGroup);
    clearChildren(headGearGroup);

    const r = nextDna.bodyRadius;
    const length = nextDna.bodyLength;
    const neckZ = length * 0.5;

    // Neck collar ring whenever the cat wears a helmet, pack or harness.
    if (nextDna.helmet || nextDna.pack !== 'none' || nextDna.harness) {
      const collarGeo = new TorusGeometry(r * 1.02, r * 0.07, 10, 32);
      const collar = new Mesh(collarGeo, darkMat);
      collar.position.set(0, 0, neckZ);
      collar.castShadow = true;
      torsoGearGroup.add(collar);
    }

    if (nextDna.pack === 'jetpack' && nextDna.harness) {
      torsoGearGroup.add(buildHarness(r, length, orangeMat, darkMat));
    }

    if (nextDna.helmet) {
      const helmet = buildBubbleHelmet(r, length, darkMat, glassMat);
      headGearGroup.add(helmet.collar, helmet.dome);
    }

    if (nextDna.pack === 'jetpack') {
      packGroup.add(buildPetJetpack(r, length, orangeMat, greyMat, darkMat));
    } else if (nextDna.pack === 'mini_pack_brown' || nextDna.pack === 'mini_pack_blue') {
      packGroup.add(buildMiniPack(r, length, nextDna.pack, packMat, greyMat, darkMat));
    }
  };

  const dispose = (): void => {
    clearChildren(torsoGearGroup);
    clearChildren(packGroup);
    clearChildren(headGearGroup);
    orangeMat.dispose();
    greyMat.dispose();
    darkMat.dispose();
    packMat.dispose();
    glassMat.dispose();
  };

  updateGear(dna);

  return {
    torsoGearGroup,
    headGearGroup,
    packGroup,
    updateGear,
    dispose,
  };
}
