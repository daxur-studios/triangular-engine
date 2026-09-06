import {
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Shape,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import {
  HUMAN_BONE_NAMES,
  type HumanoidBoneName,
  type HumanoidRig,
} from 'triangular-engine/characters';
import {
  DEFAULT_CHARACTER_FINGER_COUNT,
  DEFAULT_CHARACTER_MAX_TRIANGLES,
  type IProceduralCharacterOptions,
  type IProceduralCharacterPalette,
} from '../character-body-archetype';

function parseHexColor(hex?: string, fallback: [number, number, number] = [0.8, 0.7, 0.6]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  try {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  } catch {
    return fallback;
  }
}

function getBoneIndex(skeleton: Skeleton, boneName: HumanoidBoneName): number {
  const index = skeleton.bones.findIndex((b) => b.name === boneName);
  if (index === -1) {
    throw new RangeError(`Unresolved bone in skeleton: "${boneName}".`);
  }
  return index;
}

export function buildExtrudedSilhouetteBodyMesh(
  rig: HumanoidRig,
  skeleton: Skeleton,
  options?: IProceduralCharacterOptions,
  palette?: Required<IProceduralCharacterPalette>,
): SkinnedMesh {
  const fingerCount = options?.fingerCount ?? DEFAULT_CHARACTER_FINGER_COUNT;
  const includeFaceMorphs = options?.includeFaceMorphs ?? false;

  const skinRgb = parseHexColor(palette?.skin, [0.92, 0.76, 0.62]);
  const torsoRgb = parseHexColor(palette?.torso, [0.85, 0.35, 0.30]);
  const legsRgb = parseHexColor(palette?.legs, [0.22, 0.25, 0.35]);
  const feetRgb = parseHexColor(palette?.feet, [0.15, 0.12, 0.10]);
  const hairRgb = parseHexColor(palette?.hair, [0.18, 0.12, 0.08]);
  const eyesRgb = parseHexColor(palette?.eyes, [0.10, 0.12, 0.16]);

  const boneIndices = new Map<HumanoidBoneName, number>();
  for (const bone of rig.bones) {
    boneIndices.set(bone.name, getBoneIndex(skeleton, bone.name));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const getPos = (name: HumanoidBoneName): Vector3 => {
    const b = rig.boneByName.get(name);
    if (!b) throw new RangeError(`Rig missing bone "${name}".`);
    return new Vector3(b.restPosition.x, b.restPosition.y, b.restPosition.z);
  };

  const hipsPos = getPos(HUMAN_BONE_NAMES.hips);
  const spinePos = getPos(HUMAN_BONE_NAMES.spine);
  const chestPos = getPos(HUMAN_BONE_NAMES.chest);
  const neckPos = getPos(HUMAN_BONE_NAMES.neck);
  const headPos = getPos(HUMAN_BONE_NAMES.head);

  const leftShoulderPos = getPos(HUMAN_BONE_NAMES.leftShoulder);
  const rightShoulderPos = getPos(HUMAN_BONE_NAMES.rightShoulder);
  const leftUpperArmPos = getPos(HUMAN_BONE_NAMES.leftUpperArm);
  const rightUpperArmPos = getPos(HUMAN_BONE_NAMES.rightUpperArm);
  const leftLowerArmPos = getPos(HUMAN_BONE_NAMES.leftLowerArm);
  const rightLowerArmPos = getPos(HUMAN_BONE_NAMES.rightLowerArm);
  const leftHandPos = getPos(HUMAN_BONE_NAMES.leftHand);
  const rightHandPos = getPos(HUMAN_BONE_NAMES.rightHand);

  const leftUpperLegPos = getPos(HUMAN_BONE_NAMES.leftUpperLeg);
  const rightUpperLegPos = getPos(HUMAN_BONE_NAMES.rightUpperLeg);
  const leftLowerLegPos = getPos(HUMAN_BONE_NAMES.leftLowerLeg);
  const rightLowerLegPos = getPos(HUMAN_BONE_NAMES.rightLowerLeg);
  const leftFootPos = getPos(HUMAN_BONE_NAMES.leftFoot);
  const rightFootPos = getPos(HUMAN_BONE_NAMES.rightFoot);
  const leftToesPos = getPos(HUMAN_BONE_NAMES.leftToes);
  const rightToesPos = getPos(HUMAN_BONE_NAMES.rightToes);

  const idxHips = boneIndices.get(HUMAN_BONE_NAMES.hips)!;
  const idxSpine = boneIndices.get(HUMAN_BONE_NAMES.spine)!;
  const idxChest = boneIndices.get(HUMAN_BONE_NAMES.chest)!;
  const idxHead = boneIndices.get(HUMAN_BONE_NAMES.head)!;
  const idxJaw = boneIndices.get(HUMAN_BONE_NAMES.jaw)!;
  const idxLeftUpperArm = boneIndices.get(HUMAN_BONE_NAMES.leftUpperArm)!;
  const idxRightUpperArm = boneIndices.get(HUMAN_BONE_NAMES.rightUpperArm)!;
  const idxLeftLowerArm = boneIndices.get(HUMAN_BONE_NAMES.leftLowerArm)!;
  const idxRightLowerArm = boneIndices.get(HUMAN_BONE_NAMES.rightLowerArm)!;
  const idxLeftHand = boneIndices.get(HUMAN_BONE_NAMES.leftHand)!;
  const idxRightHand = boneIndices.get(HUMAN_BONE_NAMES.rightHand)!;

  const idxLeftUpperLeg = boneIndices.get(HUMAN_BONE_NAMES.leftUpperLeg)!;
  const idxRightUpperLeg = boneIndices.get(HUMAN_BONE_NAMES.rightUpperLeg)!;
  const idxLeftLowerLeg = boneIndices.get(HUMAN_BONE_NAMES.leftLowerLeg)!;
  const idxRightLowerLeg = boneIndices.get(HUMAN_BONE_NAMES.rightLowerLeg)!;
  const idxLeftFoot = boneIndices.get(HUMAN_BONE_NAMES.leftFoot)!;
  const idxRightFoot = boneIndices.get(HUMAN_BONE_NAMES.rightFoot)!;
  const idxLeftToes = boneIndices.get(HUMAN_BONE_NAMES.leftToes)!;
  const idxRightToes = boneIndices.get(HUMAN_BONE_NAMES.rightToes)!;

  const headRadius = Math.max(
    0.07,
    rig.boneByName.get(HUMAN_BONE_NAMES.head)?.length
      ? rig.boneByName.get(HUMAN_BONE_NAMES.head)!.length * 0.5
      : 0.1,
  );

  // Helper to merge an ExtrudeGeometry into the main arrays
  const appendExtrudedShape = (
    shape: Shape,
    depth: number,
    bevelSize: number,
    offset: Vector3,
    rgb: readonly [number, number, number],
    boneIdx: number,
  ) => {
    const geom = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevelSize > 0,
      bevelSegments: 1,
      steps: 1,
      bevelSize,
      bevelThickness: bevelSize,
    });
    geom.center();

    const pAttr = geom.getAttribute('position');
    const nAttr = geom.getAttribute('normal');
    const gIndex = geom.getIndex();
    const base = positions.length / 3;

    for (let i = 0; i < pAttr.count; i++) {
      positions.push(pAttr.getX(i) + offset.x, pAttr.getY(i) + offset.y, pAttr.getZ(i) + offset.z);
      normals.push(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i));
      colors.push(rgb[0], rgb[1], rgb[2]);
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }

    if (gIndex) {
      for (let i = 0; i < gIndex.count; i++) {
        indices.push(gIndex.getX(i) + base);
      }
    }
    geom.dispose();
  };

  // =========================================================================
  // 1. EXTRUDED HEAD & HAIR SILHOUETTE
  // =========================================================================
  const hr = headRadius;

  // Head 2D Silhouette Profile (Frontal rounded octagonal shape)
  const headShape = new Shape();
  headShape.moveTo(-hr * 0.7, -hr * 0.5);
  headShape.lineTo(-hr * 0.75, hr * 0.2);
  headShape.lineTo(-hr * 0.45, hr * 0.85);
  headShape.lineTo(hr * 0.45, hr * 0.85);
  headShape.lineTo(hr * 0.75, hr * 0.2);
  headShape.lineTo(hr * 0.7, -hr * 0.5);
  headShape.lineTo(hr * 0.35, -hr * 0.85); // chin
  headShape.lineTo(-hr * 0.35, -hr * 0.85);
  headShape.closePath();

  appendExtrudedShape(headShape, hr * 1.3, hr * 0.08, headPos, skinRgb, idxHead);

  // Hair 2D Silhouette Crest & Bangs
  const hairShape = new Shape();
  hairShape.moveTo(-hr * 0.82, hr * 0.1);
  hairShape.lineTo(-hr * 0.82, hr * 0.95);
  hairShape.lineTo(0, hr * 1.15); // crest
  hairShape.lineTo(hr * 0.82, hr * 0.95);
  hairShape.lineTo(hr * 0.82, hr * 0.1);
  hairShape.lineTo(hr * 0.55, hr * 0.38); // stylized front bangs
  hairShape.lineTo(0, hr * 0.45);
  hairShape.lineTo(-hr * 0.55, hr * 0.38);
  hairShape.closePath();

  appendExtrudedShape(
    hairShape,
    hr * 1.45,
    hr * 0.05,
    new Vector3(headPos.x, headPos.y + hr * 0.05, headPos.z - hr * 0.05),
    hairRgb,
    idxHead,
  );

  // Layered Eyes & Nose (2D Silhouette extrusions on the face)
  const eyeShape = new Shape();
  eyeShape.absellipse(0, 0, hr * 0.11, hr * 0.14, 0, Math.PI * 2, false, 0);

  appendExtrudedShape(eyeShape, hr * 0.06, hr * 0.02, new Vector3(headPos.x - hr * 0.32, headPos.y + hr * 0.08, headPos.z + hr * 0.72), eyesRgb, idxHead);
  appendExtrudedShape(eyeShape, hr * 0.06, hr * 0.02, new Vector3(headPos.x + hr * 0.32, headPos.y + hr * 0.08, headPos.z + hr * 0.72), eyesRgb, idxHead);

  // Nose Wedge
  const noseShape = new Shape();
  noseShape.moveTo(0, hr * 0.08);
  noseShape.lineTo(hr * 0.08, -hr * 0.08);
  noseShape.lineTo(-hr * 0.08, -hr * 0.08);
  noseShape.closePath();
  appendExtrudedShape(noseShape, hr * 0.15, hr * 0.03, new Vector3(headPos.x, headPos.y - hr * 0.12, headPos.z + hr * 0.75), skinRgb, idxHead);

  // Mouth Shape
  const mouthShape = new Shape();
  mouthShape.absellipse(0, 0, hr * 0.16, hr * 0.04, 0, Math.PI * 2, false, 0);
  appendExtrudedShape(mouthShape, hr * 0.04, hr * 0.01, new Vector3(headPos.x, headPos.y - hr * 0.42, headPos.z + hr * 0.70), [0.35, 0.12, 0.14], idxJaw);

  // =========================================================================
  // 2. EXTRUDED TORSO & TUNIC SILHOUETTE
  // =========================================================================
  const chestW = Math.max(0.18, leftShoulderPos.distanceTo(rightShoulderPos));
  const torsoH = Math.max(0.35, neckPos.y - hipsPos.y);

  const tunicShape = new Shape();
  tunicShape.moveTo(-chestW * 0.7, torsoH * 0.5); // left shoulder
  tunicShape.lineTo(chestW * 0.7, torsoH * 0.5);  // right shoulder
  tunicShape.lineTo(chestW * 0.55, -torsoH * 0.1); // waist
  tunicShape.lineTo(chestW * 0.68, -torsoH * 0.6); // flared skirt
  tunicShape.lineTo(-chestW * 0.68, -torsoH * 0.6);
  tunicShape.lineTo(-chestW * 0.55, -torsoH * 0.1);
  tunicShape.closePath();

  appendExtrudedShape(
    tunicShape,
    0.19,
    0.02,
    new Vector3(chestPos.x, (chestPos.y + hipsPos.y) * 0.5, chestPos.z),
    torsoRgb,
    idxChest,
  );

  // =========================================================================
  // 3. EXTRUDED BEVELED LIMBS & HANDS
  // =========================================================================
  const limbProfile = (w: number, h: number) => {
    const s = new Shape();
    s.moveTo(-w * 0.5, -h * 0.5);
    s.lineTo(w * 0.5, -h * 0.5);
    s.lineTo(w * 0.5, h * 0.5);
    s.lineTo(-w * 0.5, h * 0.5);
    s.closePath();
    return s;
  };

  const limbThick = 0.062;

  // Arms
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, leftUpperArmPos, leftLowerArmPos, limbThick, torsoRgb, idxLeftUpperArm);
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, leftLowerArmPos, leftHandPos, limbThick * 0.85, skinRgb, idxLeftLowerArm);
  appendExtrudedHand(positions, normals, colors, skinIndices, skinWeights, indices, leftHandPos, leftLowerArmPos, limbThick, fingerCount, skinRgb, idxLeftHand, -1);

  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, rightUpperArmPos, rightLowerArmPos, limbThick, torsoRgb, idxRightUpperArm);
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, rightLowerArmPos, rightHandPos, limbThick * 0.85, skinRgb, idxRightLowerArm);
  appendExtrudedHand(positions, normals, colors, skinIndices, skinWeights, indices, rightHandPos, rightLowerArmPos, limbThick, fingerCount, skinRgb, idxRightHand, 1);

  // Legs
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, leftUpperLegPos, leftLowerLegPos, limbThick * 1.15, legsRgb, idxLeftUpperLeg);
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, leftLowerLegPos, leftFootPos, limbThick * 0.95, legsRgb, idxLeftLowerLeg);
  appendExtrudedShoe(positions, normals, colors, skinIndices, skinWeights, indices, leftFootPos, leftToesPos, limbThick, feetRgb, idxLeftFoot, idxLeftToes);

  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, rightUpperLegPos, rightLowerLegPos, limbThick * 1.15, legsRgb, idxRightUpperLeg);
  appendExtrudedLimb(positions, normals, colors, skinIndices, skinWeights, indices, rightLowerLegPos, rightFootPos, limbThick * 0.95, legsRgb, idxRightLowerLeg);
  appendExtrudedShoe(positions, normals, colors, skinIndices, skinWeights, indices, rightFootPos, rightToesPos, limbThick, feetRgb, idxRightFoot, idxRightToes);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);

  // Morph targets for ARKit compatibility
  if (includeFaceMorphs) {
    const zeroDeltas = new Float32Array(positions.length);
    geometry.morphAttributes.position = [
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
      new Float32BufferAttribute(zeroDeltas, 3),
    ];
    geometry.morphTargetsRelative = true;
  }

  const material = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.05,
  });

  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new Matrix4().identity());
  mesh.name = options?.id ?? 'extruded-silhouette-mesh';

  if (includeFaceMorphs) {
    mesh.morphTargetDictionary = {
      jawOpen: 0,
      mouthOpen: 1,
      mouthSmile: 2,
      eyeBlinkLeft: 3,
      eyeBlinkRight: 4,
      browDownLeft: 5,
      browDownRight: 6,
    };
    mesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0, 0];
  }

  return mesh;
}

const scratchDir = new Vector3();
const scratchPerp = new Vector3();
const scratchUp = new Vector3();

function appendExtrudedLimb(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  start: Vector3,
  end: Vector3,
  thickness: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
): void {
  scratchDir.subVectors(end, start).normalize();
  scratchPerp.set(0, 1, 0);
  if (Math.abs(scratchDir.dot(scratchPerp)) > 0.92) scratchPerp.set(1, 0, 0);
  scratchUp.crossVectors(scratchDir, scratchPerp).normalize();
  scratchPerp.crossVectors(scratchUp, scratchDir).normalize();

  const ht = thickness * 0.5;
  const fIdx = positions.length / 3;

  const corners: Vector3[] = [
    new Vector3().copy(start).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, ht),
  ];

  for (const p of corners) {
    positions.push(p.x, p.y, p.z);
    normals.push(0, 1, 0);
    colors.push(rgb[0], rgb[1], rgb[2]);
    skinIndices.push(boneIdx, 0, 0, 0);
    skinWeights.push(1, 0, 0, 0);
  }

  indices.push(
    fIdx, fIdx + 1, fIdx + 5, fIdx, fIdx + 5, fIdx + 4,
    fIdx + 1, fIdx + 2, fIdx + 6, fIdx + 1, fIdx + 6, fIdx + 5,
    fIdx + 2, fIdx + 3, fIdx + 7, fIdx + 2, fIdx + 7, fIdx + 6,
    fIdx + 3, fIdx, fIdx + 4, fIdx + 3, fIdx + 4, fIdx + 7,
  );
}

function appendExtrudedHand(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  handPos: Vector3,
  elbowPos: Vector3,
  thickness: number,
  _fingerCount: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
  sideSign: number,
): void {
  scratchDir.subVectors(handPos, elbowPos).normalize();
  scratchPerp.set(sideSign, 0, 0);

  const palmCenter = new Vector3().copy(handPos).addScaledVector(scratchDir, thickness * 0.7);
  appendBox(
    positions, normals, colors, skinIndices, skinWeights, indices,
    palmCenter,
    new Vector3(thickness * 1.3, thickness * 1.4, thickness * 0.5),
    rgb,
    boneIdx,
  );

  const thumbCenter = new Vector3()
    .copy(palmCenter)
    .addScaledVector(scratchPerp, -sideSign * thickness * 0.6)
    .addScaledVector(scratchDir, thickness * 0.25);
  appendBox(
    positions, normals, colors, skinIndices, skinWeights, indices,
    thumbCenter,
    new Vector3(thickness * 0.5, thickness * 0.5, thickness * 0.4),
    rgb,
    boneIdx,
  );
}

function appendExtrudedShoe(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  footPos: Vector3,
  toesPos: Vector3,
  thickness: number,
  rgb: readonly [number, number, number],
  boneFootIdx: number,
  _boneToesIdx: number,
): void {
  const footCenter = new Vector3().addVectors(footPos, toesPos).multiplyScalar(0.5);
  footCenter.y += thickness * 0.35;

  appendBox(
    positions, normals, colors, skinIndices, skinWeights, indices,
    footCenter,
    new Vector3(thickness * 1.25, thickness * 0.70, footPos.distanceTo(toesPos) * 1.3),
    rgb,
    boneFootIdx,
  );
}

function appendBox(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  center: Vector3,
  size: Vector3,
  rgb: readonly [number, number, number],
  boneIdx: number,
): void {
  const hx = size.x * 0.5;
  const hy = size.y * 0.5;
  const hz = size.z * 0.5;

  const faces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
  ];

  for (const face of faces) {
    const fIdx = positions.length / 3;
    for (const vert of face.v) {
      positions.push(center.x + vert[0], center.y + vert[1], center.z + vert[2]);
      normals.push(face.n[0], face.n[1], face.n[2]);
      colors.push(rgb[0], rgb[1], rgb[2]);
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    indices.push(fIdx, fIdx + 1, fIdx + 2, fIdx, fIdx + 2, fIdx + 3);
  }
}
