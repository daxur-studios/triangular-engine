/**
 * 3D Googly Eyes, Gaze-Tracking Pupils, Hemisphere Eyelids, Female Eyelashes,
 * and Floating Eyebrows for Capsule Doodle characters.
 */

import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  CAPSULE_GAZE_ROTATION_SCALE,
  CAPSULE_PUPIL_DEPTH_SCALE,
  CAPSULE_PUPIL_FORWARD_OFFSET,
  CAPSULE_SCLERA_DEPTH_SCALE,
  computeCapsuleBrowPlacement,
  computeCapsuleEyePlacement,
  computeCapsuleNosePlacement,
  type CapsuleBrowRigPose,
  type CapsuleCharacterDNA,
  type CapsuleEyeRigPose,
  type CapsuleFaceProjection,
} from 'triangular-engine/characters';
import { tagCapsulePart } from './capsule-id-colours';

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
  readonly noseMesh: Mesh;
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
  // Placement comes from the framework-free face probes, so probes and meshes always agree.
  const placement = computeCapsuleEyePlacement(dna, side);
  const sign = placement.sign;
  const eyeRadius = placement.radius;

  const root = new Group();
  root.name = `capsule-eye-${side}`;

  // Place on the front surface of the upper capsule head with full googly-eye protrusion
  root.position.set(placement.position.x, placement.position.y, placement.position.z);
  root.rotation.y = placement.yaw;

  // Nearly spherical bulging white eyeball for clean 3/4 and profile silhouettes
  const scleraGeo = new SphereGeometry(eyeRadius, 24, 18);
  const scleraMesh = new Mesh(scleraGeo, scleraMat);
  scleraMesh.scale.set(1, 1, CAPSULE_SCLERA_DEPTH_SCALE);
  tagCapsulePart(scleraMesh, 'eyeWhite');
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
  pupilMesh.scale.set(pScale, pScale, pScale * CAPSULE_PUPIL_DEPTH_SCALE);
  pupilMesh.position.set(0, 0, eyeRadius * CAPSULE_PUPIL_FORWARD_OFFSET);
  tagCapsulePart(pupilMesh, 'pupil');
  gazePivot.add(pupilMesh);

  // Subtle tiny specular highlight tucked in upper corner so pupils read as clean black dots
  const catchGeo = new SphereGeometry(eyeRadius * 0.032, 10, 8);
  const catchMesh = new Mesh(catchGeo, catchlightMat);
  catchMesh.position.set(-eyeRadius * 0.09, eyeRadius * 0.10, eyeRadius * 0.96);
  tagCapsulePart(catchMesh, 'pupil');
  gazePivot.add(catchMesh);

  // Eyelid tilt container (rotates on Z for angry glare vs worried/sad look)
  const eyelidTiltGroup = new Group();
  eyelidTiltGroup.scale.set(1, 1, 0.95);
  root.add(eyelidTiltGroup);

  // Upper hemisphere eyelid shell (phi: 0..2PI, theta: 0..PI/2)
  const lidRadius = eyeRadius * 1.045;
  const upperLidGeo = new SphereGeometry(lidRadius, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const upperLidMesh = new Mesh(upperLidGeo, skinMat);
  upperLidMesh.castShadow = true;
  tagCapsulePart(upperLidMesh, 'eyelid');

  const upperLidPivot = new Group();
  // In rest state (open), tuck upper lid high behind the eye so profile views show the full sclera sphere
  upperLidPivot.rotation.x = -1.34;
  upperLidPivot.add(upperLidMesh);
  eyelidTiltGroup.add(upperLidPivot);

  // Female eyelashes anchored on eyelidTiltGroup at the upper-outer horizontal corner
  const lashesGroup = new Group();
  lashesGroup.visible = dna.eyelashes;
  const lashGeo = new CapsuleGeometry(eyeRadius * 0.028, eyeRadius * 0.13, 5, 8);
  const upAxis = new Vector3(0, 1, 0);
  for (let i = 0; i < 3; i++) {
    const lash = new Mesh(lashGeo, lashMat);
    const t = i / 2; // 0..1
    const polarPhi = 0.86 + t * 0.38;
    const lashDir = new Vector3(
      sign * Math.sin(polarPhi) * 0.96,
      Math.cos(polarPhi) * 0.96 + 0.06 * (1 - t),
      0.22,
    ).normalize();
    lash.position.copy(lashDir).multiplyScalar(lidRadius + eyeRadius * 0.045);
    lash.quaternion.setFromUnitVectors(upAxis, lashDir);
    lash.castShadow = true;
    tagCapsulePart(lash, 'eyelid');
    lashesGroup.add(lash);
  }
  eyelidTiltGroup.add(lashesGroup);

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
  tagCapsulePart(lowerLidMesh, 'eyelid');
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

function createArchedBrowGeometry(r: number, sign: -1 | 1): BufferGeometry {
  const controlPoints = [-1, -0.5, 0, 0.5, 1].map((u) => {
    const x = u * r * 0.215;
    const slightInnerLift = -sign * u * r * 0.008;
    const y = r * (0.068 * Math.cos(u * Math.PI * 0.5) - 0.024) + slightInnerLift;
    const z = r * (0.052 * Math.cos(u * Math.PI * 0.5) - 0.042);
    return new Vector3(x, y, z);
  });

  const curve = new CatmullRomCurve3(controlPoints);
  const tubularSegments = 16;
  const radialSegments = 10;
  const ringVerts = radialSegments + 1;
  const maxRadius = r * 0.052;
  const forwardRef = new Vector3(0, 0, 1);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const binormal = new Vector3();
  const normal = new Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    binormal.crossVectors(forwardRef, tangent);
    if (binormal.lengthSq() < 1e-5) binormal.set(0, 1, 0);
    else binormal.normalize();
    normal.crossVectors(tangent, binormal).normalize();

    const endCap = i === 0 || i === tubularSegments;
    const taper = endCap ? 0 : Math.pow(Math.sin(t * Math.PI), 0.42);
    const rad = Math.max(0.0005, maxRadius * taper);

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      positions.push(
        pt.x + rad * (cosT * binormal.x + sinT * normal.x),
        pt.y + rad * (cosT * binormal.y + sinT * normal.y),
        pt.z + rad * (cosT * binormal.z + sinT * normal.z),
      );

      if (endCap) {
        const capSign = i === 0 ? -1 : 1;
        normals.push(tangent.x * capSign, tangent.y * capSign, tangent.z * capSign);
      } else {
        normals.push(
          cosT * binormal.x + sinT * normal.x,
          cosT * binormal.y + sinT * normal.y,
          cosT * binormal.z + sinT * normal.z,
        );
      }
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, d, b, b, d, c);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function buildFloatingEyebrow(
  side: 'left' | 'right',
  dna: CapsuleCharacterDNA,
  browMat: MeshStandardMaterial,
): Mesh {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const browGeo = createArchedBrowGeometry(r, sign);

  const browMesh = new Mesh(browGeo, browMat);
  browMesh.name = `capsule-brow-${side}`;
  browMesh.castShadow = true;
  tagCapsulePart(browMesh, 'brow');

  const placement = computeCapsuleBrowPlacement(dna, side);
  browMesh.position.set(placement.position.x, placement.position.y, placement.position.z);
  browMesh.rotation.y = placement.yaw;
  browMesh.userData['baseY'] = placement.position.y;

  return browMesh;
}

function buildButtonNose(dna: CapsuleCharacterDNA, noseMat: MeshStandardMaterial): Mesh {
  const placement = computeCapsuleNosePlacement(dna);
  const noseGeo = new SphereGeometry(placement.baseRadius, 16, 12);
  noseGeo.scale(1.08, 0.88, 0.95);
  const noseMesh = new Mesh(noseGeo, noseMat);
  noseMesh.name = 'capsule-button-nose';
  noseMesh.castShadow = true;
  noseMesh.receiveShadow = true;
  tagCapsulePart(noseMesh, 'nose');
  noseMesh.visible = placement.visible;
  noseMesh.scale.setScalar(placement.scale);
  noseMesh.position.set(placement.position.x, placement.position.y, placement.position.z);
  return noseMesh;
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
    emissiveIntensity: 0.04,
    roughness: 0.08,
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
  const noseMat = new MeshStandardMaterial({
    color: new Color(dna.skinTone).multiplyScalar(0.92),
    roughness: 0.58,
    metalness: 0.04,
  });
  const noseMesh = buildButtonNose(dna, noseMat);

  root.add(leftEye.root, rightEye.root, leftBrow, rightBrow, noseMesh);

  const applyEyePose = (eye: CapsuleEyeAssembly, pose: CapsuleEyeRigPose): void => {
    eye.gazePivot.rotation.set(
      pose.gazePitch * CAPSULE_GAZE_ROTATION_SCALE,
      pose.gazeYaw * CAPSULE_GAZE_ROTATION_SCALE,
      0,
    );
    const pScale = pose.pupilScale;
    eye.pupilMesh.scale.set(pScale, pScale, pScale * CAPSULE_PUPIL_DEPTH_SCALE);

    // Rest open angle is -1.34 rad; closing rotates forward toward +0.21 rad
    eye.upperLidPivot.rotation.x = -1.34 + pose.upperLidAngle;
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
    noseMat.color.set(nextDna.skinTone).multiplyScalar(0.92);
    browMat.color.set(nextDna.hairColor);
    leftEye.lashesGroup.visible = nextDna.eyelashes;
    rightEye.lashesGroup.visible = nextDna.eyelashes;
    const nose = computeCapsuleNosePlacement(nextDna);
    noseMesh.visible = nose.visible;
    noseMesh.scale.setScalar(nose.scale);
  };

  const dispose = (): void => {
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        (obj as Mesh).geometry.dispose();
      }
    });
    skinMat.dispose();
    noseMat.dispose();
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
    noseMesh,
    updateFromProjection,
    updateColorsAndStyle,
    dispose,
  };
}
