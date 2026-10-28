/**
 * Cat head rig for the Capsule Doodle Space Cats:
 * - Twin rounded-cone ears with recessed inner-ear triangles
 * - Optional three-spike scruffy crown tuft
 * - Wide-set bulging googly eyes, gaze pupils, catchlights and hemisphere eyelids
 * - Small dark rounded-triangle nose button and curved cheek whiskers
 *
 * The `:3` mouth itself is projected by `capsule-cat-body-material`.
 */

import {
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
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
  const angle = sign * dna.eyeSpacing;
  const eyeRadius = r * 0.225 * dna.eyeScale;

  const root = new Group();
  root.name = `capsule-cat-eye-${side}`;
  root.position.set(
    Math.sin(angle) * r * 1.0,
    r * 0.27,
    dna.bodyLength * 0.5 + Math.cos(angle) * r * 0.8,
  );
  root.rotation.y = angle * 0.35;

  const scleraMesh = new Mesh(new SphereGeometry(eyeRadius, 24, 18), scleraMat);
  scleraMesh.scale.set(1, 1, 0.82);
  scleraMesh.castShadow = true;
  scleraMesh.receiveShadow = true;
  root.add(scleraMesh);

  const gazePivot = new Group();
  gazePivot.name = `capsule-cat-eye-gaze-${side}`;
  root.add(gazePivot);

  const pupilMesh = new Mesh(new SphereGeometry(eyeRadius, 18, 14), pupilMat);
  const pScale = dna.pupilScale;
  pupilMesh.scale.set(pScale, pScale, pScale * 0.35);
  pupilMesh.position.set(0, 0, eyeRadius * 0.8);
  gazePivot.add(pupilMesh);

  const catchMesh = new Mesh(new SphereGeometry(eyeRadius * 0.085, 10, 8), catchlightMat);
  catchMesh.position.set(eyeRadius * 0.09, eyeRadius * 0.09, eyeRadius * 0.87);
  gazePivot.add(catchMesh);

  const eyelidTiltGroup = new Group();
  eyelidTiltGroup.scale.set(1, 1, 0.84);
  root.add(eyelidTiltGroup);

  const lidRadius = eyeRadius * 1.045;
  const upperLidPivot = new Group();
  upperLidPivot.rotation.x = -1.15;
  const upperLidMesh = new Mesh(
    new SphereGeometry(lidRadius, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    furMat,
  );
  upperLidMesh.castShadow = true;
  upperLidPivot.add(upperLidMesh);
  eyelidTiltGroup.add(upperLidPivot);

  const lowerLidPivot = new Group();
  lowerLidPivot.rotation.x = 1.18;
  const lowerLidMesh = new Mesh(
    new SphereGeometry(lidRadius * 0.995, 22, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
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

function buildEar(
  side: 'left' | 'right',
  dna: CapsuleCatCharacterDNA,
  furMat: MeshStandardMaterial,
  innerEarMat: MeshStandardMaterial,
): Group {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const scale = dna.earScale;
  const earHeight = r * 0.58 * scale;
  const earRadius = r * 0.23 * scale;

  const ear = new Group();
  ear.name = `capsule-cat-ear-${side}`;
  ear.position.set(sign * r * 0.42, r * 0.84, dna.bodyLength * 0.5 + r * 0.5);
  const baseX = 0.14;
  const baseZ = -sign * 0.22;
  ear.rotation.set(baseX, 0, baseZ);
  ear.userData['baseX'] = baseX;
  ear.userData['baseZ'] = baseZ;

  const outer = new Mesh(new ConeGeometry(earRadius, earHeight, 18, 1), furMat);
  outer.castShadow = true;
  outer.receiveShadow = true;
  ear.add(outer);

  const tip = new Mesh(new SphereGeometry(earRadius * 0.26, 12, 10), furMat);
  tip.position.y = earHeight * 0.5;
  ear.add(tip);

  const inner = new Mesh(
    new ConeGeometry(earRadius * 0.52, earHeight * 0.66, 12, 1),
    innerEarMat,
  );
  inner.position.set(0, -earHeight * 0.02, earRadius * 0.46);
  inner.scale.z = 0.35;
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
  group.position.set(0, r * 0.92, dna.bodyLength * 0.5 + r * 0.32);
  group.visible = dna.tuft;

  const spikes = [
    { x: -r * 0.09, h: r * 0.26, rz: 0.32 },
    { x: 0, h: r * 0.34, rz: 0.02 },
    { x: r * 0.09, h: r * 0.24, rz: -0.32 },
  ];

  for (const spike of spikes) {
    const mesh = new Mesh(new ConeGeometry(r * 0.045, spike.h, 8, 1), tuftMat);
    mesh.position.set(spike.x, spike.h * 0.4, 0);
    mesh.rotation.z = spike.rz;
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
  group.position.set(sign * r * 0.5, -r * 0.02, dna.bodyLength * 0.5 + r * 0.8);

  const count = dna.whiskerCount;
  const length = r * 0.48;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const yOffset = (t - 0.5) * r * 0.26;
    const curve = new QuadraticBezierCurve3(
      new Vector3(0, 0, 0),
      new Vector3(sign * length * 0.55, r * 0.035, -r * 0.02),
      new Vector3(sign * length, (t - 0.5) * r * 0.12 - r * 0.02, -r * 0.04),
    );
    const mesh = new Mesh(new TubeGeometry(curve, 8, r * 0.011, 5, false), whiskerMat);
    mesh.position.set(sign * r * 0.04, yOffset, 0);
    mesh.rotation.z = sign * (-0.22 + t * 0.4);
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
    color: new Color('#18191c'),
    roughness: 0.18,
    metalness: 0.05,
  });
  const catchlightMat = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    emissive: new Color('#ffffff'),
    emissiveIntensity: 0.45,
    roughness: 0.1,
  });
  const noseMat = new MeshStandardMaterial({
    color: new Color('#2a211d'),
    roughness: 0.42,
    metalness: 0.02,
  });
  const whiskerMat = new MeshStandardMaterial({
    color: new Color('#2c2622'),
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

  // Rounded-triangle nose button on the snout centre.
  const noseGeo = new ConeGeometry(r * 0.1, r * 0.11, 3, 1);
  noseGeo.rotateZ(Math.PI);
  noseGeo.scale(1, 1, 0.55);
  const nose = new Mesh(noseGeo, noseMat);
  nose.name = 'capsule-cat-nose';
  nose.position.set(0, r * 0.04, dna.bodyLength * 0.5 + r * 0.97);
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
    eye.pupilMesh.scale.set(pScale, pScale, pScale * 0.35);
    eye.upperLidPivot.rotation.x = -1.15 + pose.upperLidAngle;
    eye.lowerLidPivot.rotation.x = 1.18 - pose.lowerLidAngle;
    eye.eyelidTiltGroup.rotation.z = pose.lidTiltZ;
  };

  const updateFromProjection = (projection: CapsuleCatFaceProjection): void => {
    applyEyePose(leftEye, projection.leftEye);
    applyEyePose(rightEye, projection.rightEye);

    const perk01 = (projection.earPerk + 1) * 0.5;
    for (const ear of [leftEar, rightEar]) {
      const baseX = (ear.userData['baseX'] as number) ?? 0.14;
      ear.rotation.x = baseX - 0.48 + perk01 * 0.62;
    }

    const spreadScale = 0.92 + projection.whiskerSpread * 0.22;
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
