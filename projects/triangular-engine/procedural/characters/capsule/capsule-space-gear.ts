/**
 * Modular Space Gear & Accessories Kit for Capsule Doodle characters:
 * - Bubble Helmet ("Helmit") with dark metallic neck seal & glossy transparent dome
 * - Twin-Cylinder Orange Jetpack ("Jetpack") with intake pipes, thruster cones & telemetry box
 * - Over-Ear Comms Headset ("Headset") with antenna & boom mic
 * - Space Cap, Forehead Goggles, Ribbed Knit Beanie, Round Glasses
 * - Handheld Space Gadget ("Walkie-Talkie"), Plantable Pennant Flag, Coffee Mug & Control Tablet
 * - Spacesuit Chest Patch ("circle_badge" / "square_pack") & Neck Collar Ring
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { CapsuleCharacterDNA } from 'triangular-engine/characters';

export interface CapsuleSpaceGearResult {
  readonly torsoGearGroup: Group;
  readonly jetpackGroup: Group;
  readonly headGearGroup: Group;
  readonly handPropGroup: Group;
  readonly updateGear: (dna: CapsuleCharacterDNA) => void;
  readonly dispose: () => void;
}

function buildBubbleHelmet(
  r: number,
  darkTrimMat: MeshStandardMaterial,
  glassMat: MeshPhysicalMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-bubble-helmet';

  // Dark metallic neck seal collar ring
  const collarRingGeo = new TorusGeometry(r * 1.06, r * 0.095, 12, 32);
  collarRingGeo.rotateX(Math.PI * 0.5);
  const collarRing = new Mesh(collarRingGeo, darkTrimMat);
  collarRing.castShadow = true;
  grp.add(collarRing);

  // Inner dark collar lip
  const innerLipGeo = new CylinderGeometry(r * 1.08, r * 1.08, r * 0.14, 28, 1, true);
  const innerLip = new Mesh(innerLipGeo, darkTrimMat);
  grp.add(innerLip);

  // Large transparent bubble dome enclosing the head and hair
  const domeRadius = r * 1.54;
  const domeGeo = new SphereGeometry(domeRadius, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.78);
  const domeMesh = new Mesh(domeGeo, glassMat);
  domeMesh.position.set(0, domeRadius * 0.56, 0);
  domeMesh.renderOrder = 2;
  grp.add(domeMesh);

  return grp;
}

function buildTwinTankJetpack(
  r: number,
  orangeMat: MeshStandardMaterial,
  whiteMat: MeshStandardMaterial,
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
  buttonGreenMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-twin-jetpack';

  const tankRadius = r * 0.34;
  const tankHeight = r * 0.92;
  const tankSpacing = r * 0.40;

  for (const sign of [-1, 1] as const) {
    const tx = sign * tankSpacing;

    // Main orange cylinder tank with rounded capsule ends
    const tankGeo = new CapsuleGeometry(tankRadius, tankHeight, 12, 20);
    const tankMesh = new Mesh(tankGeo, orangeMat);
    tankMesh.position.set(tx, 0, 0);
    tankMesh.castShadow = true;
    tankMesh.receiveShadow = true;
    grp.add(tankMesh);

    // Upper & lower dark grey tank straps
    for (const bandY of [tankHeight * 0.38, -tankHeight * 0.38]) {
      const bandGeo = new CylinderGeometry(tankRadius * 1.04, tankRadius * 1.04, r * 0.11, 20);
      const bandMesh = new Mesh(bandGeo, darkMat);
      bandMesh.position.set(tx, bandY, 0);
      grp.add(bandMesh);
    }

    // Top curved grey intake pipe
    const pipeGeo = new CapsuleGeometry(tankRadius * 0.26, r * 0.28, 8, 12);
    const pipeMesh = new Mesh(pipeGeo, greyMat);
    pipeMesh.position.set(tx, tankHeight * 0.5 + tankRadius + r * 0.08, -r * 0.05);
    pipeMesh.rotation.x = -0.35;
    pipeMesh.castShadow = true;
    grp.add(pipeMesh);

    // Bottom flared grey thruster nozzle cone
    const nozzleGeo = new CylinderGeometry(tankRadius * 0.42, tankRadius * 0.68, r * 0.28, 18);
    const nozzleMesh = new Mesh(nozzleGeo, greyMat);
    nozzleMesh.position.set(tx, -(tankHeight * 0.5 + tankRadius + r * 0.06), 0);
    nozzleMesh.castShadow = true;
    grp.add(nozzleMesh);
  }

  // Center white backing saddle & dark grab loop handle
  const saddleGeo = new BoxGeometry(tankSpacing * 1.6, tankHeight * 0.78, tankRadius * 1.1);
  const saddleMesh = new Mesh(saddleGeo, whiteMat);
  saddleMesh.position.set(0, 0, r * 0.12);
  grp.add(saddleMesh);

  const handleGeo = new TorusGeometry(r * 0.22, r * 0.05, 10, 18, Math.PI);
  handleGeo.rotateY(Math.PI * 0.5);
  const handleMesh = new Mesh(handleGeo, darkMat);
  handleMesh.position.set(0, 0, -tankRadius * 0.85);
  grp.add(handleMesh);

  // Side telemetry box with indicator buttons on left tank
  const boxGeo = new BoxGeometry(r * 0.16, r * 0.42, r * 0.28);
  const boxMesh = new Mesh(boxGeo, greyMat);
  boxMesh.position.set(-tankSpacing - tankRadius * 0.92, 0, 0);
  grp.add(boxMesh);

  const btnGeo = new SphereGeometry(r * 0.045, 8, 8);
  const btn1 = new Mesh(btnGeo, darkMat);
  btn1.position.set(-tankSpacing - tankRadius * 1.12, r * 0.09, 0);
  const btn2 = new Mesh(btnGeo, buttonGreenMat);
  btn2.position.set(-tankSpacing - tankRadius * 1.12, -r * 0.09, 0);
  grp.add(btn1, btn2);

  return grp;
}

function buildCommsHeadset(
  r: number,
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-comms-headset';

  // Over-head curved band
  const bandGeo = new TorusGeometry(r * 1.07, r * 0.065, 10, 28, Math.PI * 1.05);
  const bandMesh = new Mesh(bandGeo, greyMat);
  bandMesh.rotation.z = -Math.PI * 0.025;
  bandMesh.position.set(0, r * 0.18, 0);
  bandMesh.castShadow = true;
  grp.add(bandMesh);

  // Left & Right cushioned earcups
  for (const sign of [-1, 1] as const) {
    const cupGroup = new Group();
    cupGroup.position.set(sign * r * 1.05, r * 0.16, 0);

    const outerCupGeo = new CylinderGeometry(r * 0.26, r * 0.26, r * 0.14, 20);
    outerCupGeo.rotateZ(Math.PI * 0.5);
    const outerCup = new Mesh(outerCupGeo, greyMat);
    outerCup.castShadow = true;

    const padGeo = new TorusGeometry(r * 0.22, r * 0.06, 10, 20);
    padGeo.rotateY(Math.PI * 0.5);
    const pad = new Mesh(padGeo, darkMat);
    pad.position.x = -sign * r * 0.05;

    cupGroup.add(outerCup, pad);
    grp.add(cupGroup);
  }

  // Right-side vertical whip antenna with orange ball tip
  const antGeo = new CylinderGeometry(r * 0.022, r * 0.032, r * 0.78, 8);
  const antMesh = new Mesh(antGeo, greyMat);
  antMesh.position.set(-r * 1.10, r * 0.68, -r * 0.04);
  antMesh.rotation.z = 0.12;
  grp.add(antMesh);

  const tipGeo = new SphereGeometry(r * 0.065, 10, 10);
  const tipMesh = new Mesh(tipGeo, orangeMat);
  tipMesh.position.set(-r * 1.15, r * 1.08, -r * 0.04);
  grp.add(tipMesh);

  // Left-side curved microphone boom
  const boomGeo = new CapsuleGeometry(r * 0.025, r * 0.42, 6, 10);
  const boomMesh = new Mesh(boomGeo, greyMat);
  boomMesh.position.set(r * 0.88, -r * 0.04, r * 0.48);
  boomMesh.rotation.set(1.15, 0, -0.55);
  grp.add(boomMesh);

  const micTipGeo = new CapsuleGeometry(r * 0.05, r * 0.06, 8, 10);
  const micTip = new Mesh(micTipGeo, darkMat);
  micTip.position.set(r * 0.72, -r * 0.16, r * 0.68);
  grp.add(micTip);

  return grp;
}

function buildWalkieTalkieGadget(
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-walkie-talkie';

  // Main handheld casing
  const bodyGeo = new BoxGeometry(0.11, 0.20, 0.06);
  const bodyMesh = new Mesh(bodyGeo, greyMat);
  bodyMesh.castShadow = true;
  grp.add(bodyMesh);

  // Dark screen
  const screenGeo = new BoxGeometry(0.075, 0.065, 0.015);
  const screenMesh = new Mesh(screenGeo, darkMat);
  screenMesh.position.set(0, 0.04, 0.028);
  grp.add(screenMesh);

  // Two orange transmit buttons
  const btnGeo = new BoxGeometry(0.065, 0.024, 0.018);
  const btn1 = new Mesh(btnGeo, orangeMat);
  btn1.position.set(0, -0.022, 0.028);
  const btn2 = new Mesh(btnGeo, orangeMat);
  btn2.position.set(0, -0.060, 0.028);
  grp.add(btn1, btn2);

  // Top antenna with orange tip
  const antGeo = new CylinderGeometry(0.008, 0.012, 0.11, 8);
  const antMesh = new Mesh(antGeo, greyMat);
  antMesh.position.set(0.028, 0.15, 0);
  grp.add(antMesh);

  const tipGeo = new SphereGeometry(0.022, 10, 10);
  const tipMesh = new Mesh(tipGeo, orangeMat);
  tipMesh.position.set(0.028, 0.21, 0);
  grp.add(tipMesh);

  // Rotate slightly so it sits upright in the character's gripped hand
  grp.position.set(0, 0.06, 0.02);
  grp.rotation.set(-0.35, 0.25, 0);
  return grp;
}

function buildSpacePennantFlag(
  greyMat: MeshStandardMaterial,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-space-flag';

  const poleGeo = new CylinderGeometry(0.014, 0.014, 0.42, 10);
  const poleMesh = new Mesh(poleGeo, greyMat);
  poleMesh.position.set(0, 0.14, 0);
  poleMesh.castShadow = true;
  grp.add(poleMesh);

  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.22, 0.06);
  shape.lineTo(0.17, 0);
  shape.lineTo(0.22, -0.06);
  shape.lineTo(0, 0);

  const flagGeo = new ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false });
  const flagMesh = new Mesh(flagGeo, orangeMat);
  flagMesh.position.set(0.01, 0.26, -0.008);
  flagMesh.castShadow = true;
  grp.add(flagMesh);

  return grp;
}

function buildSpaceCap(
  r: number,
  whiteMat: MeshStandardMaterial,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-space-cap';

  const domeGeo = new SphereGeometry(r * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.46);
  const domeMesh = new Mesh(domeGeo, whiteMat);
  domeMesh.castShadow = true;
  grp.add(domeMesh);

  const billGeo = new CylinderGeometry(
    r * 1.04,
    r * 1.12,
    r * 0.06,
    24,
    1,
    false,
    -Math.PI * 0.34,
    Math.PI * 0.68,
  );
  const billMesh = new Mesh(billGeo, orangeMat);
  billMesh.position.set(0, r * 0.08, r * 0.24);
  billMesh.rotation.x = 0.14;
  billMesh.castShadow = true;
  grp.add(billMesh);

  const badgeGeo = new SphereGeometry(r * 0.11, 12, 10);
  badgeGeo.scale(1.0, 0.85, 0.35);
  const badgeMesh = new Mesh(badgeGeo, orangeMat);
  badgeMesh.position.set(0, r * 0.44, r * 0.98);
  grp.add(badgeMesh);

  const ringGeo = new TorusGeometry(r * 0.15, r * 0.018, 8, 18);
  ringGeo.rotateX(Math.PI * 0.38);
  ringGeo.rotateZ(-0.28);
  const ringMesh = new Mesh(ringGeo, orangeMat);
  ringMesh.position.set(0, r * 0.44, r * 1.0);
  grp.add(ringMesh);

  return grp;
}

function buildForeheadGoggles(
  r: number,
  orangeMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
  greyMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-forehead-goggles';

  const strapGeo = new TorusGeometry(r * 1.02, r * 0.048, 10, 28);
  strapGeo.rotateX(Math.PI * 0.5);
  const strap = new Mesh(strapGeo, darkMat);
  strap.rotation.x = -0.18;
  grp.add(strap);

  for (const sign of [-1, 1] as const) {
    const angle = sign * 0.32;
    const cupGrp = new Group();
    cupGrp.position.set(Math.sin(angle) * r * 1.02, r * 0.14, Math.cos(angle) * r * 1.02);
    cupGrp.rotation.y = angle * 0.85;
    cupGrp.rotation.x = -0.22;

    const rimGeo = new TorusGeometry(r * 0.23, r * 0.055, 12, 22);
    const rimMesh = new Mesh(rimGeo, orangeMat);
    rimMesh.castShadow = true;

    const lensGeo = new CylinderGeometry(r * 0.21, r * 0.21, r * 0.06, 20);
    lensGeo.rotateX(Math.PI * 0.5);
    const lensMesh = new Mesh(lensGeo, darkMat);

    cupGrp.add(rimMesh, lensMesh);
    grp.add(cupGrp);
  }

  const bridgeGeo = new CapsuleGeometry(r * 0.032, r * 0.14, 6, 8);
  bridgeGeo.rotateZ(Math.PI * 0.5);
  const bridge = new Mesh(bridgeGeo, greyMat);
  bridge.position.set(0, r * 0.14, r * 1.05);
  grp.add(bridge);

  return grp;
}

function buildKnitBeanie(
  r: number,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-knit-beanie';

  const tiltGroup = new Group();
  tiltGroup.position.set(0, r * 0.08, -r * 0.04);
  tiltGroup.rotation.x = -0.20;
  grp.add(tiltGroup);

  const domeGeo = new SphereGeometry(r * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.46);
  const dome = new Mesh(domeGeo, orangeMat);
  dome.position.y = r * 0.06;
  dome.castShadow = true;
  tiltGroup.add(dome);

  const cuffGeo = new TorusGeometry(r * 1.04, r * 0.13, 14, 32);
  cuffGeo.rotateX(Math.PI * 0.5);
  const cuff = new Mesh(cuffGeo, orangeMat);
  cuff.position.y = r * 0.12;
  cuff.rotation.x = -0.04;
  cuff.castShadow = true;
  tiltGroup.add(cuff);

  // Ribbed knit texture along the folded beanie cuff
  const ribGeo = new CapsuleGeometry(r * 0.028, r * 0.18, 4, 6);
  const ribCount = 10;
  for (let i = 0; i < ribCount; i++) {
    const theta = (i / ribCount) * Math.PI * 2;
    const rib = new Mesh(ribGeo, orangeMat);
    rib.position.set(Math.sin(theta) * r * 1.13, r * 0.13, Math.cos(theta) * r * 1.13);
    rib.castShadow = true;
    tiltGroup.add(rib);
  }

  return grp;
}

function buildRoundGlasses(
  dna: CapsuleCharacterDNA,
  darkMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-round-glasses';
  const r = dna.bodyRadius;
  const eyeBaseY = dna.suitSplitY + dna.bodyHeight * 0.365 + r * 0.04;

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const sizeAsym = (dna.eyeSizeAsymmetry ?? 0) * sign * 0.5;
    const sideEyeScale = Math.max(0.55, dna.eyeScale * (1 + sizeAsym));
    const eyeRadius = r * 0.385 * sideEyeScale;
    const heightShift = (dna.eyeHeightAsymmetry ?? 0) * sign * r;
    const angle = sign * Math.max(0.45, dna.eyeSpacing * 1.72);

    const frameGeo = new TorusGeometry(eyeRadius * 1.08, r * 0.036, 12, 26);
    const frameMesh = new Mesh(frameGeo, darkMat);
    frameMesh.position.set(
      Math.sin(angle) * r * 1.04,
      eyeBaseY + heightShift,
      Math.cos(angle) * r * 1.08 + eyeRadius * 0.50,
    );
    frameMesh.rotation.y = angle * 0.38;
    frameMesh.castShadow = true;
    grp.add(frameMesh);
  }

  const bridgeGeo = new CapsuleGeometry(r * 0.026, r * 0.34, 6, 8);
  bridgeGeo.rotateZ(Math.PI * 0.5);
  const bridgeMesh = new Mesh(bridgeGeo, darkMat);
  bridgeMesh.position.set(0, eyeBaseY, r * 1.14);
  grp.add(bridgeMesh);

  return grp;
}

function buildCoffeeMug(
  orangeMat: MeshStandardMaterial,
  whiteMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-coffee-mug';

  const cupGeo = new CylinderGeometry(0.068, 0.064, 0.14, 20);
  const cupMesh = new Mesh(cupGeo, orangeMat);
  cupMesh.castShadow = true;
  grp.add(cupMesh);

  const coffeeGeo = new CylinderGeometry(0.056, 0.056, 0.01, 18);
  const coffeeMesh = new Mesh(coffeeGeo, darkMat);
  coffeeMesh.position.y = 0.068;
  grp.add(coffeeMesh);

  const handleGeo = new TorusGeometry(0.038, 0.012, 10, 18, Math.PI);
  handleGeo.rotateZ(-Math.PI * 0.5);
  const handleMesh = new Mesh(handleGeo, orangeMat);
  handleMesh.position.set(0.064, 0, 0);
  grp.add(handleMesh);

  const emblemGeo = new SphereGeometry(0.018, 10, 8);
  emblemGeo.scale(1, 1, 0.35);
  const emblem = new Mesh(emblemGeo, whiteMat);
  emblem.position.set(0, 0, 0.066);
  grp.add(emblem);

  grp.position.set(0.02, 0.05, 0.03);
  grp.rotation.set(-0.3, 0.2, 0);
  return grp;
}

function buildControlTablet(
  greyMat: MeshStandardMaterial,
  darkMat: MeshStandardMaterial,
  orangeMat: MeshStandardMaterial,
): Group {
  const grp = new Group();
  grp.name = 'capsule-control-tablet';

  const bodyGeo = new BoxGeometry(0.18, 0.24, 0.028);
  const bodyMesh = new Mesh(bodyGeo, greyMat);
  bodyMesh.castShadow = true;
  grp.add(bodyMesh);

  const screenGeo = new BoxGeometry(0.145, 0.19, 0.01);
  const screenMesh = new Mesh(screenGeo, darkMat);
  screenMesh.position.set(0, 0, 0.014);
  grp.add(screenMesh);

  const btnPositions: ReadonlyArray<readonly [number, number]> = [
    [-0.035, 0.045],
    [0.035, 0.045],
    [-0.035, -0.015],
    [0.035, -0.015],
  ];
  const btnGeo = new BoxGeometry(0.042, 0.036, 0.012);
  for (const [bx, by] of btnPositions) {
    const btn = new Mesh(btnGeo, orangeMat);
    btn.position.set(bx, by, 0.018);
    grp.add(btn);
  }

  grp.position.set(0.03, 0.06, 0.03);
  grp.rotation.set(-0.42, 0.32, -0.1);
  return grp;
}

/**
 * Builds the complete Space Gear & Accessories kit for a Capsule Doodle character.
 */
export function buildCapsuleSpaceGear(dna: CapsuleCharacterDNA): CapsuleSpaceGearResult {
  const torsoGearGroup = new Group();
  torsoGearGroup.name = 'capsule-torso-gear';

  const jetpackGroup = new Group();
  jetpackGroup.name = 'capsule-jetpack-socket';
  torsoGearGroup.add(jetpackGroup);

  const headGearGroup = new Group();
  headGearGroup.name = 'capsule-head-gear';

  const handPropGroup = new Group();
  handPropGroup.name = 'capsule-hand-prop';

  const orangeMat = new MeshStandardMaterial({
    color: new Color(dna.suitTrimColor),
    roughness: 0.42,
    metalness: 0.12,
  });

  const whiteMat = new MeshStandardMaterial({
    color: new Color(dna.suitColor),
    roughness: 0.55,
    metalness: 0.05,
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

  const buttonGreenMat = new MeshStandardMaterial({
    color: new Color('#22c55e'),
    emissive: new Color('#16a34a'),
    emissiveIntensity: 0.35,
    roughness: 0.3,
  });

  const glassMat = new MeshPhysicalMaterial({
    color: new Color('#e0f2fe'),
    transparent: true,
    opacity: 0.32,
    roughness: 0.08,
    metalness: 0.05,
    reflectivity: 0.9,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    depthWrite: false,
  });

  const clearChildren = (grp: Group): void => {
    for (const child of [...grp.children]) {
      if (child === jetpackGroup) continue;
      child.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          (obj as Mesh).geometry.dispose();
        }
      });
      grp.remove(child);
    }
  };

  const updateGear = (nextDna: CapsuleCharacterDNA): void => {
    orangeMat.color.set(nextDna.suitTrimColor);
    whiteMat.color.set(nextDna.suitColor);

    clearChildren(torsoGearGroup);
    clearChildren(jetpackGroup);
    clearChildren(headGearGroup);
    clearChildren(handPropGroup);

    const r = nextDna.bodyRadius;
    const splitY = nextDna.suitSplitY;

    // Suit collar ring when jetpack or helmet is active
    if (nextDna.jetpack || nextDna.helmet || nextDna.chestPatch !== 'none') {
      const neckBandGeo = new TorusGeometry(r * 1.01, r * 0.075, 10, 28);
      neckBandGeo.rotateX(Math.PI * 0.5);
      const neckBand = new Mesh(neckBandGeo, darkMat);
      neckBand.position.set(0, splitY, 0);
      neckBand.castShadow = true;
      torsoGearGroup.add(neckBand);
    }

    // Chest Patch: Circle Badge or Square Comms Pack
    if (nextDna.chestPatch === 'circle_badge') {
      const badgeGeo = new CylinderGeometry(r * 0.16, r * 0.16, r * 0.05, 18);
      badgeGeo.rotateX(Math.PI * 0.5);
      const badge = new Mesh(badgeGeo, orangeMat);
      badge.position.set(-r * 0.34, splitY - r * 0.32, r * 0.94);
      badge.rotation.y = -0.34;
      badge.castShadow = true;
      torsoGearGroup.add(badge);
    } else if (nextDna.chestPatch === 'square_pack') {
      const packGeo = new BoxGeometry(r * 0.46, r * 0.38, r * 0.18);
      const pack = new Mesh(packGeo, orangeMat);
      pack.position.set(0, splitY - r * 0.38, r * 0.96);
      pack.castShadow = true;
      torsoGearGroup.add(pack);
    }

    // Twin-tank Jetpack
    if (nextDna.jetpack) {
      const jetpackMesh = buildTwinTankJetpack(
        r,
        orangeMat,
        whiteMat,
        greyMat,
        darkMat,
        buttonGreenMat,
      );
      jetpackMesh.position.set(0, splitY - r * 0.18, -r * 1.25);
      jetpackGroup.add(jetpackMesh);
    }

    // Bubble Helmet
    if (nextDna.helmet) {
      const helmetMesh = buildBubbleHelmet(r, darkMat, glassMat);
      helmetMesh.position.set(0, splitY + r * 0.04, 0);
      headGearGroup.add(helmetMesh);
    }

    // Accessories: Headgear, Eyewear & Handheld Gadgets
    if (nextDna.accessory === 'headset' && !nextDna.helmet) {
      const headset = buildCommsHeadset(r, greyMat, darkMat, orangeMat);
      headset.position.set(0, splitY + nextDna.bodyHeight * 0.25, 0);
      headGearGroup.add(headset);
    } else if (nextDna.accessory === 'space_cap' && !nextDna.helmet) {
      const cap = buildSpaceCap(r, whiteMat, orangeMat);
      cap.position.set(0, nextDna.bodyHeight * 0.5, 0);
      headGearGroup.add(cap);
    } else if (nextDna.accessory === 'goggles' && !nextDna.helmet) {
      const goggles = buildForeheadGoggles(r, orangeMat, darkMat, greyMat);
      goggles.position.set(0, splitY + nextDna.bodyHeight * 0.52, 0);
      headGearGroup.add(goggles);
    } else if (nextDna.accessory === 'beanie' && !nextDna.helmet) {
      const beanie = buildKnitBeanie(r, orangeMat);
      beanie.position.set(0, nextDna.bodyHeight * 0.5, 0);
      headGearGroup.add(beanie);
    } else if (nextDna.accessory === 'glasses') {
      headGearGroup.add(buildRoundGlasses(nextDna, darkMat));
    } else if (nextDna.accessory === 'walkie_talkie') {
      handPropGroup.add(buildWalkieTalkieGadget(greyMat, darkMat, orangeMat));
    } else if (nextDna.accessory === 'flag') {
      handPropGroup.add(buildSpacePennantFlag(greyMat, orangeMat));
    } else if (nextDna.accessory === 'coffee_mug') {
      handPropGroup.add(buildCoffeeMug(orangeMat, whiteMat, darkMat));
    } else if (nextDna.accessory === 'tablet') {
      handPropGroup.add(buildControlTablet(greyMat, darkMat, orangeMat));
    }
  };

  const dispose = (): void => {
    clearChildren(torsoGearGroup);
    clearChildren(jetpackGroup);
    clearChildren(headGearGroup);
    clearChildren(handPropGroup);
    orangeMat.dispose();
    whiteMat.dispose();
    greyMat.dispose();
    darkMat.dispose();
    buttonGreenMat.dispose();
    glassMat.dispose();
  };

  updateGear(dna);

  return {
    torsoGearGroup,
    jetpackGroup,
    headGearGroup,
    handPropGroup,
    updateGear,
    dispose,
  };
}
