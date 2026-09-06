import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LinearFilter,
  Matrix4,
  MeshStandardMaterial,
  SRGBColorSpace,
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
import type { CharacterFaceWeights } from '../character-face';

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

export function buildFacetedVectorBodyMesh(
  rig: HumanoidRig,
  skeleton: Skeleton,
  options?: IProceduralCharacterOptions,
  palette?: Required<IProceduralCharacterPalette>,
): SkinnedMesh {
  const fingerCount = options?.fingerCount ?? DEFAULT_CHARACTER_FINGER_COUNT;
  const includeFaceMorphs = options?.includeFaceMorphs ?? false;

  const skinRgb = parseHexColor(palette?.skin, [0.94, 0.78, 0.64]);
  const torsoRgb = parseHexColor(palette?.torso, [0.20, 0.50, 0.85]);
  const legsRgb = parseHexColor(palette?.legs, [0.18, 0.22, 0.32]);
  const feetRgb = parseHexColor(palette?.feet, [0.12, 0.12, 0.16]);
  const hairRgb = parseHexColor(palette?.hair, [0.25, 0.16, 0.10]);
  const eyesColorHex = palette?.eyes ?? '#182030';
  const skinColorHex = palette?.skin ?? '#f0c7a4';

  const boneIndices = new Map<HumanoidBoneName, number>();
  for (const bone of rig.bones) {
    boneIndices.set(bone.name, getBoneIndex(skeleton, bone.name));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
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
  const idxNeck = boneIndices.get(HUMAN_BONE_NAMES.neck)!;
  const idxHead = boneIndices.get(HUMAN_BONE_NAMES.head)!;
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

  // =========================================================================
  // 1. DYNAMIC VECTOR FACE CANVAS TEXTURE
  // =========================================================================
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const faceTexture = new CanvasTexture(canvas);
  faceTexture.colorSpace = SRGBColorSpace;
  faceTexture.minFilter = LinearFilter;

  const renderFaceCanvas = (weights?: Partial<CharacterFaceWeights>) => {
    if (!ctx) return;
    const wJaw = weights?.jawOpen ?? 0;
    const wMouth = weights?.mouthOpen ?? 0;
    const wSmile = weights?.mouthSmile ?? 0;
    const wBlinkL = weights?.eyeBlinkLeft ?? 0;
    const wBlinkR = weights?.eyeBlinkRight ?? 0;
    const wBrowL = weights?.browDownLeft ?? 0;
    const wBrowR = weights?.browDownRight ?? 0;

    ctx.clearRect(0, 0, 256, 256);

    // Warm face skin base
    ctx.fillStyle = skinColorHex;
    ctx.fillRect(0, 0, 256, 256);

    // Subtle cheek blush
    ctx.fillStyle = 'rgba(255, 120, 120, 0.28)';
    ctx.beginPath();
    ctx.ellipse(60, 142, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(196, 142, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // 1. Eyebrows
    ctx.strokeStyle = '#382218';
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';

    // Left brow (tilt down if browDown)
    ctx.beginPath();
    ctx.moveTo(50, 88 + wBrowL * 10);
    ctx.quadraticCurveTo(74, 76 + (1 - wBrowL) * 4, 98, 86 + wBrowL * 14);
    ctx.stroke();

    // Right brow
    ctx.beginPath();
    ctx.moveTo(158, 86 + wBrowR * 14);
    ctx.quadraticCurveTo(182, 76 + (1 - wBrowR) * 4, 206, 88 + wBrowR * 10);
    ctx.stroke();

    // 2. Eyes
    const drawEye = (cx: number, cy: number, blink: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      const hScale = Math.max(0.08, 1 - blink);

      if (hScale < 0.18) {
        // Cute closed happy eye curve
        ctx.strokeStyle = '#182030';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(0, 0, 14, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      } else {
        // White sclera
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 22 * hScale, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark iris/pupil
        ctx.fillStyle = eyesColorHex;
        ctx.beginPath();
        ctx.ellipse(0, 2 * hScale, 11, 14 * hScale, 0, 0, Math.PI * 2);
        ctx.fill();

        // Catchlight highlight
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(4, -4 * hScale, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    drawEye(74, 116, wBlinkL);
    drawEye(182, 116, wBlinkR);

    // 3. Cute button nose
    ctx.fillStyle = 'rgba(180, 100, 70, 0.45)';
    ctx.beginPath();
    ctx.ellipse(128, 148, 5.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. Expressive Mouth
    const openAmount = Math.max(wJaw, wMouth);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a1518';

    if (openAmount > 0.12) {
      // Open mouth for speech / talking
      const mH = openAmount * 24;
      const mW = 20 + wSmile * 10;
      ctx.fillStyle = '#3a0d12';
      ctx.beginPath();
      ctx.ellipse(128, 186, mW, mH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tongue
      ctx.fillStyle = '#e86a7a';
      ctx.beginPath();
      ctx.ellipse(128, 186 + mH * 0.4, mW * 0.65, mH * 0.45, 0, 0, Math.PI);
      ctx.fill();
    } else {
      // Smiling or neutral curve
      const smileLift = (wSmile - 0.2) * 16;
      ctx.beginPath();
      ctx.moveTo(104, 184 - smileLift * 0.3);
      ctx.quadraticCurveTo(128, 186 + Math.max(4, smileLift), 152, 184 - smileLift * 0.3);
      ctx.stroke();
    }

    faceTexture.needsUpdate = true;
  };

  renderFaceCanvas();

  // =========================================================================
  // 2. FACETED 3D HEAD WITH FRONT VECTOR FACE PLATE
  // =========================================================================
  const hr = headRadius;
  const headCenter = headPos;

  // Head front face quad (UV mapped to faceTexture)
  const faceZ = headCenter.z + hr * 0.88;
  const faceHalfW = hr * 0.72;
  const faceTopY = headCenter.y + hr * 0.82;
  const faceBotY = headCenter.y - hr * 0.72;

  const fIdx = positions.length / 3;
  // Vertices: Top-Left, Top-Right, Bot-Right, Bot-Left
  positions.push(
    headCenter.x - faceHalfW, faceTopY, faceZ,
    headCenter.x + faceHalfW, faceTopY, faceZ,
    headCenter.x + faceHalfW * 0.85, faceBotY, faceZ - hr * 0.1, // tapered chin
    headCenter.x - faceHalfW * 0.85, faceBotY, faceZ - hr * 0.1,
  );
  normals.push(0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1);
  colors.push(1, 1, 1,  1, 1, 1,  1, 1, 1,  1, 1, 1); // 1,1,1 so texture shows fully
  uvs.push(0, 1,  1, 1,  1, 0,  0, 0);
  for (let i = 0; i < 4; i++) {
    skinIndices.push(idxHead, 0, 0, 0);
    skinWeights.push(1, 0, 0, 0);
  }
  indices.push(fIdx, fIdx + 1, fIdx + 2, fIdx, fIdx + 2, fIdx + 3);

  // Head Faceted Box Body (Temples, Crown, Occiput, Chin)
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    new Vector3(headCenter.x, headCenter.y, headCenter.z - hr * 0.1),
    new Vector3(hr * 1.5, hr * 1.6, hr * 1.6),
    skinRgb,
    idxHead,
  );

  // Stylized Chunky Hair Cap (Yakudoo faceted blocks over crown and back)
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    new Vector3(headCenter.x, headCenter.y + hr * 0.45, headCenter.z - hr * 0.25),
    new Vector3(hr * 1.65, hr * 1.0, hr * 1.7),
    hairRgb,
    idxHead,
  );

  // =========================================================================
  // 3. FACETED TORSO & TUNIC
  // =========================================================================
  const hipW = Math.max(0.12, leftUpperLegPos.distanceTo(rightUpperLegPos));
  const chestW = Math.max(0.18, leftShoulderPos.distanceTo(rightShoulderPos));

  // Chest / Shoulders (Faceted trapezoid)
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    new Vector3(chestPos.x, (chestPos.y + neckPos.y) * 0.5, chestPos.z),
    new Vector3(chestW * 1.25, 0.22, 0.20),
    torsoRgb,
    idxChest,
  );

  // Abdomen (Spine)
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    new Vector3(spinePos.x, spinePos.y, spinePos.z),
    new Vector3(chestW * 1.05, 0.20, 0.18),
    torsoRgb,
    idxSpine,
  );

  // Hips / Tunic Hem
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    new Vector3(hipsPos.x, hipsPos.y - 0.04, hipsPos.z),
    new Vector3(hipW * 1.35, 0.22, 0.21),
    legsRgb,
    idxHips,
  );

  // =========================================================================
  // 4. FACETED LIMBS & HANDS
  // =========================================================================
  const limbThick = 0.065;

  // Left Arm
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftUpperArmPos, leftLowerArmPos, limbThick, torsoRgb, idxLeftUpperArm);
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftLowerArmPos, leftHandPos, limbThick * 0.85, skinRgb, idxLeftLowerArm);
  appendFacetedHand(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftHandPos, leftLowerArmPos, limbThick, fingerCount, skinRgb, idxLeftHand, -1);

  // Right Arm
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightUpperArmPos, rightLowerArmPos, limbThick, torsoRgb, idxRightUpperArm);
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightLowerArmPos, rightHandPos, limbThick * 0.85, skinRgb, idxRightLowerArm);
  appendFacetedHand(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightHandPos, rightLowerArmPos, limbThick, fingerCount, skinRgb, idxRightHand, 1);

  // Left Leg
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftUpperLegPos, leftLowerLegPos, limbThick * 1.15, legsRgb, idxLeftUpperLeg);
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftLowerLegPos, leftFootPos, limbThick * 0.95, legsRgb, idxLeftLowerLeg);
  appendFacetedShoe(positions, normals, colors, uvs, skinIndices, skinWeights, indices, leftFootPos, leftToesPos, limbThick, feetRgb, idxLeftFoot, idxLeftToes);

  // Right Leg
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightUpperLegPos, rightLowerLegPos, limbThick * 1.15, legsRgb, idxRightUpperLeg);
  appendFacetedLimb(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightLowerLegPos, rightFootPos, limbThick * 0.95, legsRgb, idxRightLowerLeg);
  appendFacetedShoe(positions, normals, colors, uvs, skinIndices, skinWeights, indices, rightFootPos, rightToesPos, limbThick, feetRgb, idxRightFoot, idxRightToes);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);

  // Minimal dummy relative morph attributes for ARKit compatibility
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

  // Material with flatShading & map for the face
  const material = new MeshStandardMaterial({
    map: faceTexture,
    vertexColors: true,
    flatShading: true,
    roughness: 0.8,
    metalness: 0.1,
  });

  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new Matrix4().identity());
  mesh.name = options?.id ?? 'faceted-vector-mesh';

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

  // Attach live vector face update callback on userData
  mesh.userData['vectorFace'] = renderFaceCanvas;

  return mesh;
}

function appendBeveledFacetedBlock(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
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
      uvs.push(0.5, 0.5); // non-face geometry maps to neutral point
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    indices.push(fIdx, fIdx + 1, fIdx + 2, fIdx, fIdx + 2, fIdx + 3);
  }
}

const scratchDir = new Vector3();
const scratchPerp = new Vector3();
const scratchUp = new Vector3();

function appendFacetedLimb(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  start: Vector3,
  end: Vector3,
  thickness: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
): void {
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5);
  const len = start.distanceTo(end);
  scratchDir.subVectors(end, start).normalize();

  // Simple box oriented along limb axis
  scratchPerp.set(0, 1, 0);
  if (Math.abs(scratchDir.dot(scratchPerp)) > 0.92) scratchPerp.set(1, 0, 0);
  scratchUp.crossVectors(scratchDir, scratchPerp).normalize();
  scratchPerp.crossVectors(scratchUp, scratchDir).normalize();

  const ht = thickness * 0.5;
  const hl = len * 0.5;

  const fIdx = positions.length / 3;
  const corners: Vector3[] = [
    // Bottom cap
    new Vector3().copy(start).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, ht),
    new Vector3().copy(start).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, ht),
    // Top cap
    new Vector3().copy(end).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, -ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, ht).addScaledVector(scratchUp, ht),
    new Vector3().copy(end).addScaledVector(scratchPerp, -ht).addScaledVector(scratchUp, ht),
  ];

  for (const p of corners) {
    positions.push(p.x, p.y, p.z);
    normals.push(0, 1, 0);
    colors.push(rgb[0], rgb[1], rgb[2]);
    uvs.push(0.5, 0.5);
    skinIndices.push(boneIdx, 0, 0, 0);
    skinWeights.push(1, 0, 0, 0);
  }

  // 4 side quads
  indices.push(
    fIdx, fIdx + 1, fIdx + 5, fIdx, fIdx + 5, fIdx + 4,
    fIdx + 1, fIdx + 2, fIdx + 6, fIdx + 1, fIdx + 6, fIdx + 5,
    fIdx + 2, fIdx + 3, fIdx + 7, fIdx + 2, fIdx + 7, fIdx + 6,
    fIdx + 3, fIdx, fIdx + 4, fIdx + 3, fIdx + 4, fIdx + 7,
  );
}

function appendFacetedHand(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
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
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    palmCenter,
    new Vector3(thickness * 1.3, thickness * 1.4, thickness * 0.6),
    rgb,
    boneIdx,
  );

  // Angled thumb block
  const thumbCenter = new Vector3()
    .copy(palmCenter)
    .addScaledVector(scratchPerp, -sideSign * thickness * 0.6)
    .addScaledVector(scratchDir, thickness * 0.3);
  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    thumbCenter,
    new Vector3(thickness * 0.5, thickness * 0.5, thickness * 0.5),
    rgb,
    boneIdx,
  );
}

function appendFacetedShoe(
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  footPos: Vector3,
  toesPos: Vector3,
  thickness: number,
  rgb: readonly [number, number, number],
  boneFootIdx: number,
  boneToesIdx: number,
): void {
  const footCenter = new Vector3().addVectors(footPos, toesPos).multiplyScalar(0.5);
  footCenter.y += thickness * 0.35;

  appendBeveledFacetedBlock(
    positions, normals, colors, uvs, skinIndices, skinWeights, indices,
    footCenter,
    new Vector3(thickness * 1.25, thickness * 0.75, footPos.distanceTo(toesPos) * 1.3),
    rgb,
    boneFootIdx,
  );
}
