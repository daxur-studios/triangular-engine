import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
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
  createProceduralRandom01,
  hashProceduralKey,
} from '../core/procedural-hash';
import {
  CHARACTER_MAX_TRIANGLES_PER_MESH,
  DEFAULT_CHARACTER_FINGER_COUNT,
  DEFAULT_CHARACTER_MAX_TRIANGLES,
  DEFAULT_CHARACTER_RADIAL_SEGMENTS,
  type IProceduralCharacterOptions,
  type IProceduralCharacterPalette,
  validateProceduralCharacterOptions,
} from './character-body-archetype';
import { buildExtrudedSilhouetteBodyMesh } from './builders/extruded-silhouette-builder';
import { buildFacetedVectorBodyMesh } from './builders/faceted-vector-builder';
import { buildVillagerBodyMesh } from './builders/villager-builder';

export interface ICharacterMeshResult {
  readonly mesh: SkinnedMesh;
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

const DEFAULT_SKIN_PALETTES: readonly string[] = [
  '#f6d2b8',
  '#e8b997',
  '#d49d78',
  '#ba7d56',
  '#8c5836',
  '#59351e',
];

const DEFAULT_TORSO_PALETTES: readonly string[] = [
  '#2563eb',
  '#059669',
  '#dc2626',
  '#7c3aed',
  '#d97706',
  '#0891b2',
  '#475569',
  '#1e293b',
];

const DEFAULT_LEGS_PALETTES: readonly string[] = [
  '#1e293b',
  '#334155',
  '#1f2937',
  '#374151',
  '#4b5563',
  '#172554',
];

const DEFAULT_FEET_PALETTES: readonly string[] = [
  '#0f172a',
  '#1c1917',
  '#451a03',
  '#78350f',
  '#3f3f46',
];

const DEFAULT_HAIR_PALETTES: readonly string[] = [
  '#1c1917',
  '#451a03',
  '#78350f',
  '#b45309',
  '#ca8a04',
  '#cbd5e1',
];

const DEFAULT_EYES_PALETTES: readonly string[] = [
  '#111827',
  '#1e3a8a',
  '#14532d',
  '#713f12',
];

function parseHexColor(hex?: string, fallback: [number, number, number] = [0.8, 0.7, 0.6]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  try {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  } catch {
    return fallback;
  }
}

function resolveDeterministicPalette(
  options?: IProceduralCharacterOptions,
): Required<IProceduralCharacterPalette> {
  const seedKey = String(options?.seed ?? 'triangular-character-seed');
  const seedHash = hashProceduralKey(seedKey);
  const rng = createProceduralRandom01(seedHash);

  const skin =
    options?.palette?.skin ??
    DEFAULT_SKIN_PALETTES[Math.floor(rng() * DEFAULT_SKIN_PALETTES.length)];
  const torso =
    options?.palette?.torso ??
    DEFAULT_TORSO_PALETTES[Math.floor(rng() * DEFAULT_TORSO_PALETTES.length)];
  const legs =
    options?.palette?.legs ??
    DEFAULT_LEGS_PALETTES[Math.floor(rng() * DEFAULT_LEGS_PALETTES.length)];
  const feet =
    options?.palette?.feet ??
    DEFAULT_FEET_PALETTES[Math.floor(rng() * DEFAULT_FEET_PALETTES.length)];
  const hair =
    options?.palette?.hair ??
    DEFAULT_HAIR_PALETTES[Math.floor(rng() * DEFAULT_HAIR_PALETTES.length)];
  const eyes =
    options?.palette?.eyes ??
    DEFAULT_EYES_PALETTES[Math.floor(rng() * DEFAULT_EYES_PALETTES.length)];
  const jaw = options?.palette?.jaw ?? '#be123c';

  return { skin, torso, legs, feet, hair, eyes, jaw };
}

function getBoneIndex(
  skeleton: Skeleton,
  boneName: HumanoidBoneName,
): number {
  const index = skeleton.bones.findIndex((b) => b.name === boneName);
  if (index === -1) {
    throw new RangeError(`Unresolved bone in skeleton: "${boneName}".`);
  }
  return index;
}

interface IMorphTracking {
  readonly jawVertices: number[];
  readonly mouthVertices: number[];
  readonly leftEyeVertices: number[];
  readonly rightEyeVertices: number[];
  readonly leftBrowVertices: number[];
  readonly rightBrowVertices: number[];
}

export function buildCharacterBodyMesh(
  rig: HumanoidRig,
  skeleton: Skeleton,
  options?: IProceduralCharacterOptions,
): SkinnedMesh {
  validateProceduralCharacterOptions(options);

  const style = options?.style ?? 'villager';
  const palette = resolveDeterministicPalette(options);

  switch (style) {
    case 'villager':
      return buildVillagerBodyMesh(rig, skeleton, options, palette);
    case 'faceted-vector':
      return buildFacetedVectorBodyMesh(rig, skeleton, options, palette);
    case 'extruded-silhouette':
      return buildExtrudedSilhouetteBodyMesh(rig, skeleton, options, palette);
    case 'mannequin':
    default:
      return buildMannequinBodyMesh(rig, skeleton, options, palette);
  }
}

function buildMannequinBodyMesh(
  rig: HumanoidRig,
  skeleton: Skeleton,
  options?: IProceduralCharacterOptions,
  paletteResolved?: Required<IProceduralCharacterPalette>,
): SkinnedMesh {
  const radialSegments = options?.radialSegments ?? DEFAULT_CHARACTER_RADIAL_SEGMENTS;
  const fingerCount = options?.fingerCount ?? DEFAULT_CHARACTER_FINGER_COUNT;
  const maxTriangles = options?.maxTriangles ?? DEFAULT_CHARACTER_MAX_TRIANGLES;
  const includeFaceMorphs = options?.includeFaceMorphs ?? false;
  const palette = paletteResolved ?? resolveDeterministicPalette(options);

  // Validate required bones exist on skeleton
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

  const morphTracking: IMorphTracking = {
    jawVertices: [],
    mouthVertices: [],
    leftEyeVertices: [],
    rightEyeVertices: [],
    leftBrowVertices: [],
    rightBrowVertices: [],
  };

  const skinRgb = parseHexColor(palette.skin);
  const torsoRgb = parseHexColor(palette.torso);
  const legsRgb = parseHexColor(palette.legs);
  const feetRgb = parseHexColor(palette.feet);
  const hairRgb = parseHexColor(palette.hair);
  const eyesRgb = parseHexColor(palette.eyes);
  const jawRgb = parseHexColor(palette.jaw);

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
  const jawPos = getPos(HUMAN_BONE_NAMES.jaw);
  const leftEyePos = getPos(HUMAN_BONE_NAMES.leftEye);
  const rightEyePos = getPos(HUMAN_BONE_NAMES.rightEye);

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
  const idxJaw = boneIndices.get(HUMAN_BONE_NAMES.jaw)!;
  const idxLeftEye = boneIndices.get(HUMAN_BONE_NAMES.leftEye)!;
  const idxRightEye = boneIndices.get(HUMAN_BONE_NAMES.rightEye)!;

  const idxLeftShoulder = boneIndices.get(HUMAN_BONE_NAMES.leftShoulder)!;
  const idxRightShoulder = boneIndices.get(HUMAN_BONE_NAMES.rightShoulder)!;
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
    0.06,
    rig.boneByName.get(HUMAN_BONE_NAMES.head)?.length
      ? rig.boneByName.get(HUMAN_BONE_NAMES.head)!.length * 0.5
      : 0.1,
  );

  // 1. Pelvis & Torso (Hips -> Spine -> Chest)
  const hipWidth = Math.max(0.1, leftUpperLegPos.distanceTo(rightUpperLegPos));
  const pelvisRadius = hipWidth * 0.52;
  const chestWidth = Math.max(0.15, leftShoulderPos.distanceTo(rightShoulderPos));
  const chestRadius = chestWidth * 0.42;

  // Pelvis / Hips (tapered tube hips -> spine)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    new Vector3(hipsPos.x, hipsPos.y - 0.05, hipsPos.z),
    spinePos,
    pelvisRadius,
    pelvisRadius * 0.9,
    legsRgb,
    idxHips,
    idxSpine,
    radialSegments,
    true,
  );

  // Abdomen & Chest (Spine -> Chest)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    spinePos,
    chestPos,
    pelvisRadius * 0.9,
    chestRadius,
    torsoRgb,
    idxSpine,
    idxChest,
    radialSegments,
    true,
  );

  // Chest upper / Clavicle bridge (Chest -> Neck)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    chestPos,
    neckPos,
    chestRadius,
    chestRadius * 0.65,
    torsoRgb,
    idxChest,
    idxNeck,
    radialSegments,
    true,
  );

  // Neck (Neck -> Head)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    neckPos,
    new Vector3(headPos.x, headPos.y - headRadius * 0.7, headPos.z),
    headRadius * 0.45,
    headRadius * 0.4,
    skinRgb,
    idxNeck,
    idxHead,
    radialSegments,
    true,
  );

  // 2. Head & Facial Features
  // Head sphere
  const headStartIdx = positions.length / 3;
  appendSphere(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    headPos,
    headRadius,
    skinRgb,
    idxHead,
    radialSegments,
    Math.max(4, Math.floor(radialSegments * 0.75)),
  );
  const headEndIdx = positions.length / 3;

  // Record head vertices for morph targets
  for (let i = headStartIdx; i < headEndIdx; i++) {
    const vy = positions[i * 3 + 1];
    const vz = positions[i * 3 + 2];
    const vx = positions[i * 3];

    // Brow regions
    if (vy > headPos.y + headRadius * 0.2 && vz > headPos.z + headRadius * 0.4) {
      if (vx < headPos.x) morphTracking.leftBrowVertices.push(i);
      else morphTracking.rightBrowVertices.push(i);
    }
  }

  // Hair cap (Upper dome over head)
  appendHairCap(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    headPos,
    headRadius * 1.04,
    hairRgb,
    idxHead,
    radialSegments,
  );

  // Eyes (Left & Right eye dots)
  const eyeRadius = headRadius * 0.16;
  const leftEyeStart = positions.length / 3;
  appendSphere(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftEyePos,
    eyeRadius,
    eyesRgb,
    idxLeftEye,
    Math.max(4, Math.floor(radialSegments * 0.6)),
    4,
  );
  const leftEyeEnd = positions.length / 3;
  for (let i = leftEyeStart; i < leftEyeEnd; i++) morphTracking.leftEyeVertices.push(i);

  const rightEyeStart = positions.length / 3;
  appendSphere(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightEyePos,
    eyeRadius,
    eyesRgb,
    idxRightEye,
    Math.max(4, Math.floor(radialSegments * 0.6)),
    4,
  );
  const rightEyeEnd = positions.length / 3;
  for (let i = rightEyeStart; i < rightEyeEnd; i++) morphTracking.rightEyeVertices.push(i);

  // Jaw / Chin / Mouth segment
  const jawStart = positions.length / 3;
  appendBox(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    jawPos,
    new Vector3(headRadius * 0.45, headRadius * 0.25, headRadius * 0.35),
    jawRgb,
    idxJaw,
  );
  const jawEnd = positions.length / 3;
  for (let i = jawStart; i < jawEnd; i++) {
    morphTracking.jawVertices.push(i);
    morphTracking.mouthVertices.push(i);
  }

  // 3. Arms & Hands
  const armRadius = Math.max(0.03, chestRadius * 0.35);

  // Left Arm (Clavicle, Upper arm, Lower arm)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    chestPos,
    leftShoulderPos,
    armRadius * 1.1,
    armRadius,
    torsoRgb,
    idxChest,
    idxLeftShoulder,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftUpperArmPos,
    leftLowerArmPos,
    armRadius,
    armRadius * 0.85,
    torsoRgb,
    idxLeftUpperArm,
    idxLeftLowerArm,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftLowerArmPos,
    leftHandPos,
    armRadius * 0.85,
    armRadius * 0.7,
    skinRgb,
    idxLeftLowerArm,
    idxLeftHand,
    radialSegments,
    true,
  );
  appendHandWithFingers(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftHandPos,
    leftLowerArmPos,
    armRadius * 0.75,
    fingerCount,
    skinRgb,
    idxLeftHand,
    -1, // left side
  );

  // Right Arm (Clavicle, Upper arm, Lower arm)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    chestPos,
    rightShoulderPos,
    armRadius * 1.1,
    armRadius,
    torsoRgb,
    idxChest,
    idxRightShoulder,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightUpperArmPos,
    rightLowerArmPos,
    armRadius,
    armRadius * 0.85,
    torsoRgb,
    idxRightUpperArm,
    idxRightLowerArm,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightLowerArmPos,
    rightHandPos,
    armRadius * 0.85,
    armRadius * 0.7,
    skinRgb,
    idxRightLowerArm,
    idxRightHand,
    radialSegments,
    true,
  );
  appendHandWithFingers(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightHandPos,
    rightLowerArmPos,
    armRadius * 0.75,
    fingerCount,
    skinRgb,
    idxRightHand,
    1, // right side
  );

  // 4. Legs & Feet
  const legRadius = Math.max(0.045, pelvisRadius * 0.46);

  // Left Leg (Upper Leg -> Lower Leg -> Foot -> Toes)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftUpperLegPos,
    leftLowerLegPos,
    legRadius,
    legRadius * 0.8,
    legsRgb,
    idxLeftUpperLeg,
    idxLeftLowerLeg,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftLowerLegPos,
    leftFootPos,
    legRadius * 0.8,
    legRadius * 0.65,
    legsRgb,
    idxLeftLowerLeg,
    idxLeftFoot,
    radialSegments,
    true,
  );
  appendFoot(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    leftFootPos,
    leftToesPos,
    legRadius * 0.7,
    feetRgb,
    idxLeftFoot,
    idxLeftToes,
  );

  // Right Leg (Upper Leg -> Lower Leg -> Foot -> Toes)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightUpperLegPos,
    rightLowerLegPos,
    legRadius,
    legRadius * 0.8,
    legsRgb,
    idxRightUpperLeg,
    idxRightLowerLeg,
    radialSegments,
    true,
  );
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightLowerLegPos,
    rightFootPos,
    legRadius * 0.8,
    legRadius * 0.65,
    legsRgb,
    idxRightLowerLeg,
    idxRightFoot,
    radialSegments,
    true,
  );
  appendFoot(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    rightFootPos,
    rightToesPos,
    legRadius * 0.7,
    feetRgb,
    idxRightFoot,
    idxRightToes,
  );

  const triangleCount = indices.length / 3;
  if (triangleCount > maxTriangles || triangleCount > CHARACTER_MAX_TRIANGLES_PER_MESH) {
    throw new RangeError(
      `Procedural character mesh triangle count (${triangleCount}) exceeds budget (${Math.min(maxTriangles, CHARACTER_MAX_TRIANGLES_PER_MESH)}).`,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);

  // 5. Morph Targets (if requested)
  if (includeFaceMorphs) {
    buildARKitFaceMorphs(geometry, positions, morphTracking, headRadius);
  }

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: options?.roughness ?? 0.7,
    metalness: options?.metalness ?? 0.1,
  });

  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new Matrix4().identity());
  mesh.name = options?.id ?? 'character-body-mesh';

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

function buildARKitFaceMorphs(
  geometry: BufferGeometry,
  basePositions: readonly number[],
  morphs: IMorphTracking,
  headRadius: number,
): void {
  const count = basePositions.length / 3;

  const createMorphDelta = (
    applyFn: (vertexIdx: number, delta: [number, number, number]) => void,
  ): Float32BufferAttribute => {
    const deltas = new Float32Array(count * 3);
    const d: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      d[0] = 0;
      d[1] = 0;
      d[2] = 0;
      applyFn(i, d);
      deltas[i * 3] = d[0];
      deltas[i * 3 + 1] = d[1];
      deltas[i * 3 + 2] = d[2];
    }
    return new Float32BufferAttribute(deltas, 3);
  };

  const jawSet = new Set(morphs.jawVertices);
  const mouthSet = new Set(morphs.mouthVertices);
  const leftEyeSet = new Set(morphs.leftEyeVertices);
  const rightEyeSet = new Set(morphs.rightEyeVertices);
  const leftBrowSet = new Set(morphs.leftBrowVertices);
  const rightBrowSet = new Set(morphs.rightBrowVertices);

  const jawOpenAttr = createMorphDelta((idx, d) => {
    if (jawSet.has(idx)) {
      d[1] = -headRadius * 0.35;
      d[2] = headRadius * 0.08;
    }
  });

  const mouthOpenAttr = createMorphDelta((idx, d) => {
    if (mouthSet.has(idx)) {
      d[1] = -headRadius * 0.25;
    }
  });

  const mouthSmileAttr = createMorphDelta((idx, d) => {
    if (mouthSet.has(idx)) {
      const vx = basePositions[idx * 3];
      d[0] = vx * 0.15;
      d[1] = headRadius * 0.1;
    }
  });

  const eyeBlinkLeftAttr = createMorphDelta((idx, d) => {
    if (leftEyeSet.has(idx)) {
      d[1] = -headRadius * 0.08;
      d[2] = -headRadius * 0.04;
    }
  });

  const eyeBlinkRightAttr = createMorphDelta((idx, d) => {
    if (rightEyeSet.has(idx)) {
      d[1] = -headRadius * 0.08;
      d[2] = -headRadius * 0.04;
    }
  });

  const browDownLeftAttr = createMorphDelta((idx, d) => {
    if (leftBrowSet.has(idx)) {
      d[1] = -headRadius * 0.12;
    }
  });

  const browDownRightAttr = createMorphDelta((idx, d) => {
    if (rightBrowSet.has(idx)) {
      d[1] = -headRadius * 0.12;
    }
  });

  geometry.morphAttributes.position = [
    jawOpenAttr,
    mouthOpenAttr,
    mouthSmileAttr,
    eyeBlinkLeftAttr,
    eyeBlinkRightAttr,
    browDownLeftAttr,
    browDownRightAttr,
  ];
  geometry.morphTargetsRelative = true;
}

const scratchDir = new Vector3();
const scratchPerp = new Vector3();
const scratchUp = new Vector3();
const scratchNorm = new Vector3();
const scratchPt = new Vector3();

function appendTaperedLimb(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  start: Vector3,
  end: Vector3,
  radiusStart: number,
  radiusEnd: number,
  rgb: readonly [number, number, number],
  boneStartIdx: number,
  boneEndIdx: number,
  radialSegments: number,
  smoothGradient: boolean,
): void {
  scratchDir.subVectors(end, start);
  const len = scratchDir.length();
  if (len < 1e-5) return;
  scratchDir.normalize();

  scratchPerp.set(0, 1, 0);
  if (Math.abs(scratchDir.dot(scratchPerp)) > 0.95) {
    scratchPerp.set(1, 0, 0);
  }
  scratchUp.crossVectors(scratchDir, scratchPerp).normalize();
  scratchPerp.crossVectors(scratchUp, scratchDir).normalize();

  const baseIdx = positions.length / 3;
  const rings = 3;

  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const center = new Vector3().copy(start).addScaledVector(scratchDir, len * t);
    const rad = radiusStart + (radiusEnd - radiusStart) * t;

    const wStart = smoothGradient ? 1 - t : 1;
    const wEnd = smoothGradient ? t : 0;

    for (let s = 0; s < radialSegments; s++) {
      const angle = (s / radialSegments) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      scratchNorm
        .copy(scratchPerp)
        .multiplyScalar(cosA)
        .addScaledVector(scratchUp, sinA);
      scratchPt.copy(center).addScaledVector(scratchNorm, rad);

      positions.push(scratchPt.x, scratchPt.y, scratchPt.z);
      normals.push(scratchNorm.x, scratchNorm.y, scratchNorm.z);
      colors.push(rgb[0], rgb[1], rgb[2]);

      skinIndices.push(boneStartIdx, boneEndIdx, 0, 0);
      skinWeights.push(wStart, wEnd, 0, 0);
    }
  }

  for (let r = 0; r < rings - 1; r++) {
    const ringA = baseIdx + r * radialSegments;
    const ringB = baseIdx + (r + 1) * radialSegments;
    for (let s = 0; s < radialSegments; s++) {
      const next = (s + 1) % radialSegments;
      const a = ringA + s;
      const b = ringA + next;
      const c = ringB + s;
      const d = ringB + next;
      indices.push(a, b, c, b, d, c);
    }
  }
}

function appendSphere(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  center: Vector3,
  radius: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
  radialSegments: number,
  heightSegments: number,
): void {
  const baseIdx = positions.length / 3;

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const nx = -sinTheta * cosPhi;
      const ny = cosTheta;
      const nz = sinTheta * sinPhi;

      positions.push(
        center.x + radius * nx,
        center.y + radius * ny,
        center.z + radius * nz,
      );
      normals.push(nx, ny, nz);
      colors.push(rgb[0], rgb[1], rgb[2]);
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < radialSegments; x++) {
      const first = baseIdx + y * (radialSegments + 1) + x;
      const second = first + radialSegments + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }
}

function appendHairCap(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  center: Vector3,
  radius: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
  radialSegments: number,
): void {
  const baseIdx = positions.length / 3;
  const rings = Math.max(3, Math.floor(radialSegments * 0.5));

  for (let r = 0; r <= rings; r++) {
    const v = (r / rings) * (Math.PI * 0.45); // top dome only
    const cosTheta = Math.cos(v);
    const sinTheta = Math.sin(v);

    for (let s = 0; s <= radialSegments; s++) {
      const u = (s / radialSegments) * Math.PI * 2;
      const nx = sinTheta * Math.cos(u);
      const ny = cosTheta;
      const nz = sinTheta * Math.sin(u);

      positions.push(
        center.x + radius * nx,
        center.y + radius * ny,
        center.z + radius * nz,
      );
      normals.push(nx, ny, nz);
      colors.push(rgb[0], rgb[1], rgb[2]);
      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const first = baseIdx + r * (radialSegments + 1) + s;
      const second = first + radialSegments + 1;
      indices.push(first, first + 1, second);
      indices.push(second, first + 1, second + 1);
    }
  }
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

  const baseIdx = positions.length / 3;

  const faces = [
    // +Z front
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    // -Z back
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    // +Y top
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    // -Y bottom
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    // +X right
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    // -X left
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

function appendHandWithFingers(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  handPos: Vector3,
  elbowPos: Vector3,
  handRadius: number,
  fingerCount: number,
  rgb: readonly [number, number, number],
  boneIdx: number,
  sideSign: number, // -1 left, +1 right
): void {
  // Hand direction (downward/forward along lower arm)
  scratchDir.subVectors(handPos, elbowPos).normalize();
  scratchPerp.set(sideSign, 0, 0);
  scratchUp.crossVectors(scratchDir, scratchPerp).normalize();

  // Palm box
  const palmCenter = new Vector3().copy(handPos).addScaledVector(scratchDir, handRadius * 0.8);
  appendBox(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    palmCenter,
    new Vector3(handRadius * 1.3, handRadius * 1.4, handRadius * 0.6),
    rgb,
    boneIdx,
  );

  // Thumb
  const thumbBase = new Vector3()
    .copy(palmCenter)
    .addScaledVector(scratchPerp, -sideSign * handRadius * 0.7)
    .addScaledVector(scratchUp, handRadius * 0.2);
  const thumbTip = new Vector3()
    .copy(thumbBase)
    .addScaledVector(scratchPerp, -sideSign * handRadius * 0.5)
    .addScaledVector(scratchDir, handRadius * 0.5);
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    thumbBase,
    thumbTip,
    handRadius * 0.3,
    handRadius * 0.2,
    rgb,
    boneIdx,
    boneIdx,
    4,
    false,
  );

  if (fingerCount === 0) {
    // Mitten paddle (simple low poly pad)
    const mittenTip = new Vector3().copy(palmCenter).addScaledVector(scratchDir, handRadius * 1.2);
    appendTaperedLimb(
      positions,
      normals,
      colors,
      skinIndices,
      skinWeights,
      indices,
      palmCenter,
      mittenTip,
      handRadius * 0.6,
      handRadius * 0.4,
      rgb,
      boneIdx,
      boneIdx,
      4,
      false,
    );
  } else {
    // 1 to 5 fingers
    const fingersToDraw = Math.min(5, Math.max(1, fingerCount));
    const activeMainFingers = fingersToDraw === 5 ? 4 : fingersToDraw;
    const fSpacing = (handRadius * 1.1) / Math.max(1, activeMainFingers);
    const fLen = handRadius * 0.9;

    for (let f = 0; f < activeMainFingers; f++) {
      const offset = (f - (activeMainFingers - 1) * 0.5) * fSpacing;
      const fBase = new Vector3()
        .copy(palmCenter)
        .addScaledVector(scratchPerp, offset)
        .addScaledVector(scratchDir, handRadius * 0.7);
      const fTip = new Vector3().copy(fBase).addScaledVector(scratchDir, fLen);

      appendTaperedLimb(
        positions,
        normals,
        colors,
        skinIndices,
        skinWeights,
        indices,
        fBase,
        fTip,
        handRadius * 0.22,
        handRadius * 0.16,
        rgb,
        boneIdx,
        boneIdx,
        4,
        false,
      );
    }
  }
}

function appendFoot(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  footPos: Vector3,
  toesPos: Vector3,
  footRadius: number,
  rgb: readonly [number, number, number],
  boneFootIdx: number,
  boneToesIdx: number,
): void {
  const heelCenter = new Vector3(footPos.x, footPos.y + footRadius * 0.4, footPos.z - footRadius * 0.5);
  const toeCenter = new Vector3(toesPos.x, toesPos.y + footRadius * 0.35, toesPos.z);

  // Main shoe body (Heel to Toes)
  appendTaperedLimb(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    heelCenter,
    toeCenter,
    footRadius * 0.95,
    footRadius * 0.75,
    rgb,
    boneFootIdx,
    boneToesIdx,
    6,
    true,
  );

  // Toe box cap
  appendBox(
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    toeCenter,
    new Vector3(footRadius * 1.3, footRadius * 0.7, footRadius * 0.8),
    rgb,
    boneToesIdx,
  );
}
