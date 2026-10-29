/**
 * Cat head rig for the Capsule Doodle Space Cats:
 * - 3D Pointed cat ears with soft beveled contour & recessed inner-ear pink triangles
 * - Optional three-spike scruffy crown tuft
 * - Wide-set bulging googly eyes, gaze pupils, catchlights and hemisphere eyelids
 * - Small dark rounded nose button and gracefully curved cheek whiskers
 *
 * The `:3` mouth itself is projected by `capsule-cat-body-material`.
 */

import {
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type {
  CapsuleCatCharacterDNA,
  CapsuleCatFaceProjection,
  CapsuleEyeRigPose,
} from 'triangular-engine/characters';

export interface CapsuleCatEyeAssembly {
  readonly root: Group;
  readonly gazePivot: Group;
  readonly pupilMesh: Mesh;
  readonly eyelidTiltGroup: Group;
  readonly upperLidPivot: Group;
  readonly lowerLidPivot: Group;
  readonly baseEyeRadius: number;
}

export interface CapsuleCatFaceRigResult {
  readonly root: Group;
  readonly leftEye: CapsuleCatEyeAssembly;
  readonly rightEye: CapsuleCatEyeAssembly;
  readonly leftEar: Group;
  readonly rightEar: Group;
  readonly tuftGroup: Group;
  readonly leftWhiskers: Group;
  readonly rightWhiskers: Group;
  readonly updateFromProjection: (projection: CapsuleCatFaceProjection) => void;
  readonly updateColorsAndStyle: (dna: CapsuleCatCharacterDNA) => void;
  readonly dispose: () => void;
}

function buildSingleCatEye(
  side: 'left' | 'right',
  dna: CapsuleCatCharacterDNA,
  furMat: MeshStandardMaterial,
  scleraMat: MeshStandardMaterial,
  pupilMat: MeshStandardMaterial,
  catchlightMat: MeshStandardMaterial,
): CapsuleCatEyeAssembly {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const eyeRadius = r * 0.28 * dna.eyeScale;

  // Surface placement on the front hemisphere dome (z = bodyLength * 0.5)
  const angle = sign * dna.eyeSpacing;
  const elevation = 0.34; // ~19.5 degrees elevation
  const cosEl = Math.cos(elevation);
  const sinEl = Math.sin(elevation);

  const nx = cosEl * Math.sin(angle);
  const ny = sinEl;
  const nz = cosEl * Math.cos(angle);

  const px = r * nx;
  const py = r * ny;
  const pz = dna.bodyLength * 0.5 + r * nz;

  const root = new Group();
  root.name = `capsule-cat-eye-${side}`;
  root.position.set(px, py, pz);

  // Orient local +Z along the surface outward normal
  const target = new Vector3(px + nx, py + ny, pz + nz);
  root.lookAt(target);

  // Sclera: bulging googly sphere seated slightly embedded into the head
  const scleraGeo = new SphereGeometry(eyeRadius, 24, 20);
  const scleraMesh = new Mesh(scleraGeo, scleraMat);
  scleraMesh.position.set(0, 0, -eyeRadius * 0.2);
  scleraMesh.scale.set(1, 1, 0.88);
  scleraMesh.castShadow = true;
  scleraMesh.receiveShadow = true;
  root.add(scleraMesh);

  // Gaze pivot rotates pupil + catchlight along the front surface of the eye
  const gazePivot = new Group();
  gazePivot.name = `capsule-cat-eye-gaze-${side}`;
  gazePivot.position.set(0, 0, -eyeRadius * 0.2);
  root.add(gazePivot);

  const pupilGeo = new SphereGeometry(eyeRadius, 18, 14);
  const pupilMesh = new Mesh(pupilGeo, pupilMat);
  const pScale = dna.pupilScale;
  pupilMesh.scale.set(pScale, pScale, pScale * 0.24);
  pupilMesh.position.set(0, 0, eyeRadius * 0.94);
  gazePivot.add(pupilMesh);

  const catchGeo = new SphereGeometry(eyeRadius * 0.09, 10, 8);
  const catchMesh = new Mesh(catchGeo, catchlightMat);
  catchMesh.position.set(eyeRadius * 0.12, eyeRadius * 0.12, eyeRadius * 0.98);
  gazePivot.add(catchMesh);

  // Eyelids container
  const eyelidTiltGroup = new Group();
  eyelidTiltGroup.position.set(0, 0, -eyeRadius * 0.2);
  root.add(eyelidTiltGroup);

  const lidRadius = eyeRadius * 1.05;
  const upperLidPivot = new Group();
  // In rest state, fully retract upper eyelid so derpy googly eye is 100% visible
  upperLidPivot.rotation.x = -1.35;
  const upperLidMesh = new Mesh(
    new SphereGeometry(lidRadius, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    furMat,
  );
  upperLidMesh.castShadow = true;
  upperLidPivot.add(upperLidMesh);
  eyelidTiltGroup.add(upperLidPivot);

  const lowerLidPivot = new Group();
  lowerLidPivot.rotation.x = 1.35;
  const lowerLidMesh = new Mesh(
    new SphereGeometry(lidRadius * 0.995, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    furMat,
  );
  lowerLidPivot.add(lowerLidMesh);
  eyelidTiltGroup.add(lowerLidPivot);

  return {
    root,
    gazePivot,
    pupilMesh,
    eyelidTiltGroup,
    upperLidPivot,
    lowerLidPivot,
    baseEyeRadius: eyeRadius,
  };
}

function buildCatEarShape(width: number, height: number): Shape {
  const shape = new Shape();
  const hw = width * 0.5;
  shape.moveTo(-hw, 0);
  shape.quadraticCurveTo(-hw * 0.85, height * 0.52, -hw * 0.12, height * 0.94);
  shape.quadraticCurveTo(0, height, hw * 0.12, height * 0.94);
  shape.quadraticCurveTo(hw * 0.85, height * 0.52, hw, 0);
  shape.closePath();
  return shape;
}

function buildEar(
  side: 'left' | 'right',
  dna: CapsuleCatCharacterDNA,
  furMat: MeshStandardMaterial,
  innerEarMat: MeshStandardMaterial,
): Group {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const scale = dna.earScale;
  const earWidth = r * 0.44 * scale;
  const earHeight = r * 0.56 * scale;
  const earDepth = r * 0.12 * scale;

  const ear = new Group();
  ear.name = `capsule-cat-ear-${side}`;
  // Perched on top-front head dome
  ear.position.set(sign * r * 0.44, r * 0.82, dna.bodyLength * 0.5 + r * 0.32);

  const baseX = -0.10;
  const baseY = sign * 0.22;
  const baseZ = -sign * 0.32;
  ear.rotation.set(baseX, baseY, baseZ);
  ear.userData['baseX'] = baseX;
  ear.userData['baseY'] = baseY;
  ear.userData['baseZ'] = baseZ;

  // Outer beveled 3D cat ear
  const outerShape = buildCatEarShape(earWidth, earHeight);
  const outerGeo = new ExtrudeGeometry(outerShape, {
    depth: earDepth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: earWidth * 0.06,
    bevelThickness: earDepth * 0.35,
  });
  outerGeo.center();
  const outer = new Mesh(outerGeo, furMat);
  outer.castShadow = true;
  outer.receiveShadow = true;
  ear.add(outer);

  // Inner recessed pink triangle
  const innerShape = buildCatEarShape(earWidth * 0.70, earHeight * 0.72);
  const innerGeo = new ExtrudeGeometry(innerShape, {
    depth: earDepth * 0.3,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: earWidth * 0.03,
    bevelThickness: earDepth * 0.15,
  });
  innerGeo.center();
  const inner = new Mesh(innerGeo, innerEarMat);
  inner.position.set(0, -earHeight * 0.05, earDepth * 0.55);
  ear.add(inner);

  return ear;
}

function buildCrownTuft(
  dna: CapsuleCatCharacterDNA,
  tuftMat: MeshStandardMaterial,
): Group {
  const r = dna.bodyRadius;
  const group = new Group();
  group.name = 'capsule-cat-crown-tuft';
  group.position.set(0, r * 0.94, dna.bodyLength * 0.5 + r * 0.28);
  group.visible = dna.tuft;

  const spikes = [
    { x: -r * 0.1, h: r * 0.26, rz: 0.35, rx: 0.05 },
    { x: 0, h: r * 0.36, rz: 0.02, rx: 0.08 },
    { x: r * 0.1, h: r * 0.24, rz: -0.35, rx: 0.05 },
  ];

  for (const spike of spikes) {
    const geo = new ConeGeometry(r * 0.05, spike.h, 10, 1);
    const mesh = new Mesh(geo, tuftMat);
    mesh.position.set(spike.x, spike.h * 0.45, 0);
    mesh.rotation.z = spike.rz;
    mesh.rotation.x = spike.rx;
    mesh.castShadow = true;
    group.add(mesh);
  }

  return group;
}

function buildWhiskers(
  side: 'left' | 'right',
  dna: CapsuleCatCharacterDNA,
  whiskerMat: MeshStandardMaterial,
): Group {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const group = new Group();
  group.name = `capsule-cat-whiskers-${side}`;
  // Attached to cheek pad beside snout
  group.position.set(sign * r * 0.28, r * 0.04, dna.bodyLength * 0.5 + r * 0.92);

  const count = dna.whiskerCount;
  const length = r * 0.50;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const yOffset = (t - 0.5) * r * 0.14;
    // Curved whiskers arcing outwards, slightly downwards and backwards
    const curve = new QuadraticBezierCurve3(
      new Vector3(0, 0, 0),
      new Vector3(sign * length * 0.55, -r * 0.01 + yOffset * 0.5, -r * 0.06),
      new Vector3(sign * length, yOffset - r * 0.06, -r * 0.18),
    );
    const geo = new TubeGeometry(curve, 10, r * 0.012, 6, false);
    const mesh = new Mesh(geo, whiskerMat);
    mesh.castShadow = true;
    group.add(mesh);
  }

  return group;
}

/**
 * Builds the complete cat facial rig (ears, tuft, googly eyes, eyelids, nose, whiskers).
 */
export function buildCapsuleCatFaceRig(dna: CapsuleCatCharacterDNA): CapsuleCatFaceRigResult {
  const root = new Group();
  root.name = 'capsule-cat-face-rig';
  const r = dna.bodyRadius;

  const furMat = new MeshStandardMaterial({
    color: new Color(dna.furColor),
    roughness: 0.68,
    metalness: 0.02,
    side: DoubleSide,
  });
  const innerEarMat = new MeshStandardMaterial({
    color: new Color(dna.innerEarColor),
    roughness: 0.72,
    metalness: 0.0,
    side: DoubleSide,
  });
  const scleraMat = new MeshStandardMaterial({
    color: new Color('#fcfbf9'),
    roughness: 0.22,
    metalness: 0.02,
  });
  const pupilMat = new MeshStandardMaterial({
    color: new Color('#16171a'),
    roughness: 0.18,
    metalness: 0.05,
  });
  const catchlightMat = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    emissive: new Color('#ffffff'),
    emissiveIntensity: 0.55,
    roughness: 0.1,
  });
  const noseMat = new MeshStandardMaterial({
    color: new Color('#251c19'),
    roughness: 0.42,
    metalness: 0.02,
  });
  const whiskerMat = new MeshStandardMaterial({
    color: new Color('#27201c'),
    roughness: 0.6,
    metalness: 0.0,
  });
  const tuftMat = new MeshStandardMaterial({
    color: new Color(dna.furAccentColor),
    roughness: 0.72,
    metalness: 0.02,
  });

  const leftEye = buildSingleCatEye('left', dna, furMat, scleraMat, pupilMat, catchlightMat);
  const rightEye = buildSingleCatEye('right', dna, furMat, scleraMat, pupilMat, catchlightMat);
  const leftEar = buildEar('left', dna, furMat, innerEarMat);
  const rightEar = buildEar('right', dna, furMat, innerEarMat);
  const tuftGroup = buildCrownTuft(dna, tuftMat);
  const leftWhiskers = buildWhiskers('left', dna, whiskerMat);
  const rightWhiskers = buildWhiskers('right', dna, whiskerMat);

  // Smooth rounded dark nose button on the snout centre
  const noseGeo = new CapsuleGeometry(r * 0.045, r * 0.05, 8, 12);
  noseGeo.rotateZ(Math.PI * 0.5);
  const nose = new Mesh(noseGeo, noseMat);
  nose.name = 'capsule-cat-nose';
  nose.position.set(0, r * 0.08, dna.bodyLength * 0.5 + r * 0.985);
  nose.scale.set(1.2, 0.9, 0.65);
  nose.castShadow = true;

  root.add(
    leftEye.root,
    rightEye.root,
    leftEar,
    rightEar,
    tuftGroup,
    leftWhiskers,
    rightWhiskers,
    nose,
  );

  const applyEyePose = (eye: CapsuleCatEyeAssembly, pose: CapsuleEyeRigPose): void => {
    eye.gazePivot.rotation.set(pose.gazePitch * 0.75, pose.gazeYaw * 0.75, 0);
    const pScale = pose.pupilScale;
    eye.pupilMesh.scale.set(pScale, pScale, pScale * 0.24);
    eye.upperLidPivot.rotation.x = -1.35 + pose.upperLidAngle * 1.5;
    eye.lowerLidPivot.rotation.x = 1.35 - pose.lowerLidAngle * 1.3;
    eye.eyelidTiltGroup.rotation.z = pose.lidTiltZ;
  };

  const updateFromProjection = (projection: CapsuleCatFaceProjection): void => {
    applyEyePose(leftEye, projection.leftEye);
    applyEyePose(rightEye, projection.rightEye);

    // earPerk in [-1, 1]: alert = perk forward, fearful = flatten back & spread
    for (const ear of [leftEar, rightEar]) {
      const isLeft = ear.name.includes('left');
      const sign = isLeft ? -1 : 1;
      const baseX = (ear.userData['baseX'] as number) ?? -0.10;
      const baseZ = (ear.userData['baseZ'] as number) ?? -sign * 0.32;
      const perk = projection.earPerk;
      if (perk >= 0) {
        ear.rotation.x = baseX + perk * 0.32;
        ear.rotation.z = baseZ;
      } else {
        ear.rotation.x = baseX + perk * 0.48;
        ear.rotation.z = baseZ - sign * perk * 0.18;
      }
    }

    const spreadScale = 0.92 + projection.whiskerSpread * 0.24;
    leftWhiskers.scale.setScalar(spreadScale);
    rightWhiskers.scale.setScalar(spreadScale);
  };

  const updateColorsAndStyle = (nextDna: CapsuleCatCharacterDNA): void => {
    furMat.color.set(nextDna.furColor);
    innerEarMat.color.set(nextDna.innerEarColor);
    tuftMat.color.set(nextDna.furAccentColor);
    tuftGroup.visible = nextDna.tuft;
    leftWhiskers.visible = nextDna.whiskerCount > 0;
    rightWhiskers.visible = nextDna.whiskerCount > 0;
  };

  const dispose = (): void => {
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).geometry.dispose();
      }
    });
    furMat.dispose();
    innerEarMat.dispose();
    scleraMat.dispose();
    pupilMat.dispose();
    catchlightMat.dispose();
    noseMat.dispose();
    whiskerMat.dispose();
    tuftMat.dispose();
  };

  return {
    root,
    leftEye,
    rightEye,
    leftEar,
    rightEar,
    tuftGroup,
    leftWhiskers,
    rightWhiskers,
    updateFromProjection,
    updateColorsAndStyle,
    dispose,
  };
}
