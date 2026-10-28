/**
 * 3D Googly Eyes, Gaze-Tracking Pupils, Hemisphere Eyelids, Female Eyelashes,
 * and Floating Eyebrows for Capsule Doodle characters.
 */

import {
  CapsuleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type {
  CapsuleBrowRigPose,
  CapsuleCharacterDNA,
  CapsuleEyeRigPose,
  CapsuleFaceProjection,
} from 'triangular-engine/characters';

export interface CapsuleEyeAssembly {
  readonly root: Group;
  readonly gazePivot: Group;
  readonly pupilMesh: Mesh;
  readonly eyelidTiltGroup: Group;
  readonly upperLidPivot: Group;
  readonly lowerLidPivot: Group;
  readonly lashesGroup: Group;
  readonly baseEyeRadius: number;
}

export interface CapsuleFaceRigResult {
  readonly root: Group;
  readonly leftEye: CapsuleEyeAssembly;
  readonly rightEye: CapsuleEyeAssembly;
  readonly leftBrow: Mesh;
  readonly rightBrow: Mesh;
  readonly updateFromProjection: (projection: CapsuleFaceProjection) => void;
  readonly updateColorsAndStyle: (dna: CapsuleCharacterDNA) => void;
  readonly dispose: () => void;
}

function buildSingleGooglyEye(
  side: 'left' | 'right',
  dna: CapsuleCharacterDNA,
  skinMat: MeshStandardMaterial,
  scleraMat: MeshStandardMaterial,
  pupilMat: MeshStandardMaterial,
  catchlightMat: MeshStandardMaterial,
  lashMat: MeshStandardMaterial,
): CapsuleEyeAssembly {
  const sign = side === 'left' ? -1 : 1;
  const eyeRadius = dna.bodyRadius * 0.255 * dna.eyeScale;

  const root = new Group();
  root.name = `capsule-eye-${side}`;

  // Place on the front cylindrical surface of the upper capsule head
  const angle = sign * dna.eyeSpacing;
  const surfaceR = dna.bodyRadius * 0.95;
  const eyeY = dna.suitSplitY + dna.bodyHeight * 0.34;
  root.position.set(
    Math.sin(angle) * surfaceR,
    eyeY,
    Math.cos(angle) * surfaceR,
  );
  root.rotation.y = angle * 0.45;

  // Slightly Z-flattened bulging white eyeball
  const scleraGeo = new SphereGeometry(eyeRadius, 24, 18);
  const scleraMesh = new Mesh(scleraGeo, scleraMat);
  scleraMesh.scale.set(1, 1, 0.82);
  scleraMesh.castShadow = true;
  scleraMesh.receiveShadow = true;
  root.add(scleraMesh);

  // Gaze pivot rotates pupil + catchlight along the front surface of the eye
  const gazePivot = new Group();
  gazePivot.name = `capsule-eye-gaze-${side}`;
  root.add(gazePivot);

  const pupilGeo = new SphereGeometry(eyeRadius, 18, 14);
  const pupilMesh = new Mesh(pupilGeo, pupilMat);
  const pScale = dna.pupilScale;
  pupilMesh.scale.set(pScale, pScale, pScale * 0.35);
  pupilMesh.position.set(0, 0, eyeRadius * 0.80);
  gazePivot.add(pupilMesh);

  // Glossy cartoon catchlight dot
  const catchGeo = new SphereGeometry(eyeRadius * 0.085, 10, 8);
  const catchMesh = new Mesh(catchGeo, catchlightMat);
  catchMesh.position.set(eyeRadius * 0.09, eyeRadius * 0.09, eyeRadius * 0.87);
  gazePivot.add(catchMesh);

  // Eyelid tilt container (rotates on Z for angry glare vs worried/sad look)
  const eyelidTiltGroup = new Group();
  eyelidTiltGroup.scale.set(1, 1, 0.84);
  root.add(eyelidTiltGroup);

  // Upper hemisphere eyelid shell (phi: 0..2PI, theta: 0..PI/2)
  const lidRadius = eyeRadius * 1.045;
  const upperLidGeo = new SphereGeometry(lidRadius, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const upperLidMesh = new Mesh(upperLidGeo, skinMat);
  upperLidMesh.castShadow = true;

  const upperLidPivot = new Group();
  // In rest state (open), tilt the upper hemisphere back so only a thin upper rim frames the eye
  upperLidPivot.rotation.x = -1.15;
  upperLidPivot.add(upperLidMesh);
  eyelidTiltGroup.add(upperLidPivot);

  // Optional female eyelashes attached to the outer rim of the upper eyelid
  const lashesGroup = new Group();
  lashesGroup.visible = dna.eyelashes;
  const lashGeo = new CapsuleGeometry(eyeRadius * 0.032, eyeRadius * 0.14, 4, 6);
  for (let i = 0; i < 3; i++) {
    const lash = new Mesh(lashGeo, lashMat);
    const t = i / 2; // 0..1
    const lashAngle = sign * (0.42 + t * 0.46);
    lash.position.set(
      Math.sin(lashAngle) * lidRadius * 1.02,
      -0.01 + (1 - t) * eyeRadius * 0.06,
      Math.cos(lashAngle) * lidRadius * 0.92,
    );
    lash.rotation.z = -sign * (0.65 + t * 0.35);
    lash.rotation.x = 0.25;
    lashesGroup.add(lash);
  }
  upperLidPivot.add(lashesGroup);

  // Lower hemisphere eyelid shell (theta: PI/2..PI)
  const lowerLidGeo = new SphereGeometry(
    lidRadius * 0.995,
    22,
    12,
    0,
    Math.PI * 2,
    Math.PI * 0.5,
    Math.PI * 0.5,
  );
  const lowerLidMesh = new Mesh(lowerLidGeo, skinMat);
  const lowerLidPivot = new Group();
  lowerLidPivot.rotation.x = 1.18;
  lowerLidPivot.add(lowerLidMesh);
  eyelidTiltGroup.add(lowerLidPivot);

  return {
    root,
    gazePivot,
    pupilMesh,
    eyelidTiltGroup,
    upperLidPivot,
    lowerLidPivot,
    lashesGroup,
    baseEyeRadius: eyeRadius,
  };
}

function buildFloatingEyebrow(
  side: 'left' | 'right',
  dna: CapsuleCharacterDNA,
  browMat: MeshStandardMaterial,
): Mesh {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const browGeo = new CapsuleGeometry(r * 0.046, r * 0.22, 6, 10);
  // Rotate capsule geometry so its length runs horizontally along X
  browGeo.rotateZ(Math.PI * 0.5);

  const browMesh = new Mesh(browGeo, browMat);
  browMesh.name = `capsule-brow-${side}`;
  browMesh.castShadow = true;

  const angle = sign * dna.eyeSpacing * 1.02;
  const surfaceR = r * 1.01;
  const baseBrowY = dna.suitSplitY + dna.bodyHeight * 0.34 + r * 0.33 * dna.eyeScale;

  browMesh.position.set(
    Math.sin(angle) * surfaceR,
    baseBrowY,
    Math.cos(angle) * surfaceR,
  );
  browMesh.rotation.y = angle * 0.65;
  browMesh.userData['baseY'] = baseBrowY;

  return browMesh;
}

/**
 * Builds the complete protruding facial rig (googly eyes, pupils, eyelids, lashes, eyebrows).
 */
export function buildCapsuleFaceRig(dna: CapsuleCharacterDNA): CapsuleFaceRigResult {
  const root = new Group();
  root.name = 'capsule-face-rig';

  const skinMat = new MeshStandardMaterial({
    color: new Color(dna.skinTone),
    roughness: 0.62,
    metalness: 0.04,
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

  const browMat = new MeshStandardMaterial({
    color: new Color(dna.hairColor),
    roughness: 0.72,
    metalness: 0.04,
  });

  const lashMat = new MeshStandardMaterial({
    color: new Color('#1e1f24'),
    roughness: 0.5,
  });

  const leftEye = buildSingleGooglyEye(
    'left',
    dna,
    skinMat,
    scleraMat,
    pupilMat,
    catchlightMat,
    lashMat,
  );
  const rightEye = buildSingleGooglyEye(
    'right',
    dna,
    skinMat,
    scleraMat,
    pupilMat,
    catchlightMat,
    lashMat,
  );

  const leftBrow = buildFloatingEyebrow('left', dna, browMat);
  const rightBrow = buildFloatingEyebrow('right', dna, browMat);

  root.add(leftEye.root, rightEye.root, leftBrow, rightBrow);

  const applyEyePose = (eye: CapsuleEyeAssembly, pose: CapsuleEyeRigPose): void => {
    eye.gazePivot.rotation.set(pose.gazePitch * 0.75, pose.gazeYaw * 0.75, 0);
    const pScale = pose.pupilScale;
    eye.pupilMesh.scale.set(pScale, pScale, pScale * 0.35);

    // Rest open angle is -1.15 rad; closing rotates forward toward +0.35 rad
    eye.upperLidPivot.rotation.x = -1.15 + pose.upperLidAngle;
    // Lower lid rest is +1.18 rad; squinting rotates upward toward +0.25 rad
    eye.lowerLidPivot.rotation.x = 1.18 - pose.lowerLidAngle;
    eye.eyelidTiltGroup.rotation.z = pose.lidTiltZ;
  };

  const applyBrowPose = (brow: Mesh, pose: CapsuleBrowRigPose): void => {
    const baseY = (brow.userData['baseY'] as number) ?? brow.position.y;
    brow.position.y = baseY + pose.heightOffset;
    brow.rotation.z = pose.zRotation;
  };

  const updateFromProjection = (projection: CapsuleFaceProjection): void => {
    applyEyePose(leftEye, projection.leftEye);
    applyEyePose(rightEye, projection.rightEye);
    applyBrowPose(leftBrow, projection.leftBrow);
    applyBrowPose(rightBrow, projection.rightBrow);
  };

  const updateColorsAndStyle = (nextDna: CapsuleCharacterDNA): void => {
    skinMat.color.set(nextDna.skinTone);
    browMat.color.set(nextDna.hairColor);
    leftEye.lashesGroup.visible = nextDna.eyelashes;
    rightEye.lashesGroup.visible = nextDna.eyelashes;
  };

  const dispose = (): void => {
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).geometry.dispose();
      }
    });
    skinMat.dispose();
    scleraMat.dispose();
    pupilMat.dispose();
    catchlightMat.dispose();
    browMat.dispose();
    lashMat.dispose();
  };

  return {
    root,
    leftEye,
    rightEye,
    leftBrow,
    rightBrow,
    updateFromProjection,
    updateColorsAndStyle,
    dispose,
  };
}
