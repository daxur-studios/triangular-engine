/**
 * Modular Space Gear kit for the Capsule Doodle Space Cats:
 * - Angled bubble helmet with a dark metallic neck collar, sized cleanly around
 *   the ears and whiskers
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
import { catHeadScale } from './capsule-cat-shape';

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
): Group {
  const helmet = new Group();
  helmet.name = 'capsule-cat-bubble-helmet';

  // The neck ring follows the capsule cross-section behind the ears.
  const collarGroup = new Group();
  const neckZ = length * 0.5 - r * 0.45;
  collarGroup.position.set(0, 0, neckZ);

  const collarRadius = r * (catHeadScale(neckZ, r, length) + 0.015);
  const collarGeo = new TorusGeometry(collarRadius, r * 0.065, 12, 36);
  const collarRing = new Mesh(collarGeo, darkMat);
  collarRing.name = 'capsule-cat-helmet-collar';
  collarRing.castShadow = true;
  collarGroup.add(collarRing);

  const lipGeo = new CylinderGeometry(collarRadius * 0.98, collarRadius * 0.98, r * 0.08, 32, 1, true);
  lipGeo.rotateX(Math.PI * 0.5);
  const lip = new Mesh(lipGeo, darkMat);
  collarGroup.add(lip);

  // Match the spherical cap's open rim to the ring; its widest section clears the ears.
  const domeRadius = r * 1.33;
  const domeAngle = Math.PI - Math.asin(collarRadius / domeRadius);
  const domeGeo = new SphereGeometry(domeRadius, 36, 24, 0, Math.PI * 2, 0, domeAngle);
  domeGeo.rotateX(Math.PI * 0.5);
  const dome = new Mesh(domeGeo, glassMat);
  dome.name = 'capsule-cat-helmet-dome';
  dome.position.z = -domeRadius * Math.cos(domeAngle);
  dome.renderOrder = 2;
  dome.castShadow = false;
  dome.receiveShadow = false;
  collarGroup.add(dome);

  helmet.add(collarGroup);
  return helmet;
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
  const z = -length * 0.06;

  const tankLength = length * 0.65;
  const tankRadius = r * 0.32;
  // The front of the body widens into the head. Seat the tank against the
  // highest part of the back beneath its cylindrical section.
  const y = r * catHeadScale(z + tankLength * 0.5, r, length) + tankRadius - r * 0.02;
  const tankGeo = new CapsuleGeometry(tankRadius, tankLength, 14, 24);
  tankGeo.rotateX(Math.PI * 0.5);
  const tank = new Mesh(tankGeo, orangeMat);
  tank.name = 'capsule-cat-jetpack-tank';
  tank.position.set(0, y, z);
  tank.castShadow = true;
  tank.receiveShadow = true;
  pack.add(tank);

  // Rear flared metallic thruster nozzle cone
  const nozzleLength = r * 0.28;
  const nozzleGeo = new CylinderGeometry(tankRadius * 0.95, tankRadius * 0.65, nozzleLength, 20);
  nozzleGeo.rotateX(-Math.PI * 0.5);
  const nozzle = new Mesh(nozzleGeo, greyMat);
  const nozzleZ = z - tankLength * 0.5 - tankRadius - nozzleLength * 0.35;
  nozzle.position.set(0, y, nozzleZ);
  nozzle.castShadow = true;
  pack.add(nozzle);

  // Dark interior exhaust disc
  const interiorGeo = new CylinderGeometry(tankRadius * 0.55, tankRadius * 0.55, r * 0.02, 16);
  interiorGeo.rotateX(-Math.PI * 0.5);
  const interior = new Mesh(interiorGeo, darkMat);
  interior.position.set(0, y, nozzleZ - nozzleLength * 0.48);
  pack.add(interior);

  // Top intake pipe fitting
  const pipeGeo = new CapsuleGeometry(tankRadius * 0.22, r * 0.26, 8, 12);
  pipeGeo.rotateZ(Math.PI * 0.5);
  const pipe = new Mesh(pipeGeo, greyMat);
  pipe.position.set(0, y + tankRadius + r * 0.10, z + tankLength * 0.12);
  pipe.castShadow = true;
  pack.add(pipe);

  // Grey side telemetry box with two indicator dots
  const boxGeo = new BoxGeometry(r * 0.18, r * 0.22, tankLength * 0.46);
  const box = new Mesh(boxGeo, greyMat);
  box.position.set(-(tankRadius + r * 0.12), y, z);
  box.castShadow = true;
  pack.add(box);

  const dotGeo = new SphereGeometry(r * 0.042, 8, 8);
  const dot1 = new Mesh(dotGeo, darkMat);
  dot1.position.set(-(tankRadius + r * 0.22), y + r * 0.05, z + r * 0.06);
  const dot2 = new Mesh(dotGeo, orangeMat);
  dot2.position.set(-(tankRadius + r * 0.22), y - r * 0.05, z - r * 0.06);
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
  const chestZ = length * 0.22;
  const bellyZ = -length * 0.15;

  for (const z of [chestZ, bellyZ]) {
    const ringGeo = new TorusGeometry(r * 1.025, r * 0.042, 10, 44);
    const ring = new Mesh(ringGeo, orangeMat);
    ring.position.set(0, 0, z);
    ring.castShadow = true;
    harness.add(ring);

    const buckleGeo = new BoxGeometry(r * 0.16, r * 0.09, r * 0.09);
    const buckle = new Mesh(buckleGeo, darkMat);
    buckle.position.set(0, r * 1.02, z);
    harness.add(buckle);
  }

  // Dorsal connector strap from chest ring to jetpack
  const packZ = -length * 0.06;
  const connectorLength = chestZ - packZ + r * 0.18;
  const connectorGeo = new BoxGeometry(r * 0.11, r * 0.05, connectorLength);
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
  const z = -length * 0.04;
  const y = r * catHeadScale(z + length * 0.14, r, length) + r * 0.26;

  if (packId === 'mini_pack_brown') {
    packMat.color.set('#8e5d3b');
  } else {
    packMat.color.set('#5b769c');
  }

  const bodyGeo = new CapsuleGeometry(r * 0.28, length * 0.28, 10, 18);
  bodyGeo.rotateX(Math.PI * 0.5);
  const body = new Mesh(bodyGeo, packMat);
  body.name = 'capsule-cat-mini-pack-body';
  body.position.set(0, y, z);
  body.castShadow = true;
  body.receiveShadow = true;
  pack.add(body);

  const flapGeo = new SphereGeometry(r * 0.29, 16, 12);
  flapGeo.scale(1.12, 0.46, 1.12);
  const flap = new Mesh(flapGeo, packMat);
  flap.position.set(0, y + r * 0.18, z);
  flap.castShadow = true;
  pack.add(flap);

  const buckleGeo = new BoxGeometry(r * 0.09, r * 0.07, r * 0.08);
  const buckle = new Mesh(buckleGeo, greyMat);
  buckle.position.set(0, y + r * 0.16, z + length * 0.16);
  pack.add(buckle);

  const strapGeo = new TorusGeometry(r * 1.02, r * 0.035, 8, 36);
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
    color: new Color('#32353b'),
    roughness: 0.52,
    metalness: 0.2,
  });
  const packMat = new MeshStandardMaterial({
    color: new Color('#8e5d3b'),
    roughness: 0.62,
    metalness: 0.04,
  });
  const glassMat = new MeshPhysicalMaterial({
    color: new Color('#eaf4fc'),
    transparent: true,
    opacity: 0.22,
    roughness: 0.06,
    metalness: 0.02,
    transmission: 0.85,
    ior: 1.45,
    reflectivity: 0.85,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
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
    const neckZ = length * 0.5 - r * 0.45;

    // Standalone neck collar ring when there is no helmet but a pack or harness is worn
    if (!nextDna.helmet && (nextDna.pack !== 'none' || nextDna.harness)) {
      const collarGeo = new TorusGeometry(r * (catHeadScale(neckZ, r, length) + 0.015), r * 0.07, 10, 36);
      const collar = new Mesh(collarGeo, darkMat);
      collar.position.set(0, 0, neckZ);
      collar.castShadow = true;
      torsoGearGroup.add(collar);
    }

    if (nextDna.pack === 'jetpack') {
      packGroup.add(buildPetJetpack(r, length, orangeMat, greyMat, darkMat));
      if (nextDna.harness) {
        torsoGearGroup.add(buildHarness(r, length, orangeMat, darkMat));
      }
    } else if (nextDna.pack === 'mini_pack_brown' || nextDna.pack === 'mini_pack_blue') {
      packGroup.add(buildMiniPack(r, length, nextDna.pack, packMat, greyMat, darkMat));
    }

    if (nextDna.helmet) {
      headGearGroup.add(buildBubbleHelmet(r, length, darkMat, glassMat));
    }
  };

  updateGear(dna);

  const dispose = (): void => {
    clearChildren(torsoGearGroup);
    clearChildren(headGearGroup);
    orangeMat.dispose();
    greyMat.dispose();
    darkMat.dispose();
    packMat.dispose();
    glassMat.dispose();
  };

  return {
    torsoGearGroup,
    headGearGroup,
    packGroup,
    updateGear,
    dispose,
  };
}
