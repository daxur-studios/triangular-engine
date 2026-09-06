import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
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
  CHARACTER_MAX_TRIANGLES_PER_MESH,
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

export function buildVillagerBodyMesh(
  rig: HumanoidRig,
  skeleton: Skeleton,
  options?: IProceduralCharacterOptions,
  palette?: Required<IProceduralCharacterPalette>,
): SkinnedMesh {
  const maxTriangles = options?.maxTriangles ?? DEFAULT_CHARACTER_MAX_TRIANGLES;
  const includeFaceMorphs = options?.includeFaceMorphs ?? false;
  const fingerCount = options?.fingerCount ?? DEFAULT_CHARACTER_FINGER_COUNT;

  const skinRgb = parseHexColor(palette?.skin, [0.88, 0.73, 0.58]);
  const torsoRgb = parseHexColor(palette?.torso, [0.18, 0.42, 0.65]); // tunic color
  const legsRgb = parseHexColor(palette?.legs, [0.15, 0.20, 0.28]);   // trousers
  const feetRgb = parseHexColor(palette?.feet, [0.22, 0.16, 0.12]);   // leather shoes
  const hairRgb = parseHexColor(palette?.hair, [0.22, 0.14, 0.08]);   // hair
  const eyesRgb = parseHexColor(palette?.eyes, [0.10, 0.12, 0.16]);   // pupil/iris
  const beltRgb = [0.12, 0.08, 0.05] as const;                        // leather belt

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
  const idxNeck = boneIndices.get(HUMAN_BONE_NAMES.neck)!;
  const idxHead = boneIndices.get(HUMAN_BONE_NAMES.head)!;
  const idxJaw = boneIndices.get(HUMAN_BONE_NAMES.jaw)!;
  const idxLeftEye = boneIndices.get(HUMAN_BONE_NAMES.leftEye)!;
  const idxRightEye = boneIndices.get(HUMAN_BONE_NAMES.rightEye)!;

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

  // Tracking vertex indices for ARKit blendshapes
  const lowerLipChinIndices: number[] = [];
  const upperLipIndices: number[] = [];
  const mouthCornerLeftIndices: number[] = [];
  const mouthCornerRightIndices: number[] = [];
  const leftBrowIndices: number[] = [];
  const rightBrowIndices: number[] = [];
  const leftEyelidIndices: number[] = [];
  const rightEyelidIndices: number[] = [];

  // =========================================================================
  // 1. SCULPTED PARAMETRIC HEAD (Black & White 2 style)
  // =========================================================================
  const numHeadRings = 14;
  const numHeadSlices = 16;
  const headStartVertex = positions.length / 3;

  for (let r = 0; r <= numHeadRings; r++) {
    const v = r / numHeadRings; // 0 = crown top, 1 = neck bottom
    const theta = v * Math.PI; // 0..PI
    const baseCos = Math.cos(theta); // 1..-1
    const baseSin = Math.sin(theta); // 0..1

    const yRel = baseCos * headRadius;
    const yNorm = baseCos; // in [-1, 1]

    for (let s = 0; s <= numHeadSlices; s++) {
      const u = s / numHeadSlices;
      const phi = u * Math.PI * 2 - Math.PI; // -PI to +PI (phi = 0 faces +Z)
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      let rad = headRadius * baseSin;
      let xOffset = 0;
      let yOffset = 0;
      let zOffset = 0;

      // Facial features sculpting on front quadrant (cosP > 0.3)
      if (cosP > 0.3 && v > 0.25 && v < 0.85) {
        const frontWeight = Math.max(0, (cosP - 0.3) / 0.7);
        const centerWeight = Math.max(0, 1 - Math.abs(phi) / 0.5);

        // 1. Brow ridge (v ≈ 0.38..0.45)
        if (v >= 0.35 && v <= 0.44) {
          const browPower = Math.sin(((v - 0.35) / 0.09) * Math.PI);
          zOffset += headRadius * 0.14 * browPower * frontWeight;
          if (sinP < -0.1) leftBrowIndices.push(positions.length / 3);
          else if (sinP > 0.1) rightBrowIndices.push(positions.length / 3);
        }

        // 2. Eye socket indentation (v ≈ 0.44..0.54, away from center nose)
        if (v >= 0.44 && v <= 0.54 && Math.abs(phi) > 0.15 && Math.abs(phi) < 0.6) {
          const socketPower = Math.sin(((v - 0.44) / 0.10) * Math.PI);
          zOffset -= headRadius * 0.18 * socketPower * frontWeight;
          if (sinP < 0) leftEyelidIndices.push(positions.length / 3);
          else rightEyelidIndices.push(positions.length / 3);
        }

        // 3. Nose pyramid (v ≈ 0.43..0.63, central |phi| < 0.25)
        if (v >= 0.43 && v <= 0.63 && Math.abs(phi) < 0.25) {
          const noseV = (v - 0.43) / 0.20;
          // Nose tip peaks near v ≈ 0.56
          const noseProfile = Math.sin(noseV * Math.PI);
          const noseSideTaper = Math.max(0, 1 - Math.abs(phi) / 0.25);
          zOffset += headRadius * 0.32 * noseProfile * noseSideTaper;
          // Slight downward flare at tip
          if (noseV > 0.6) yOffset -= headRadius * 0.04 * noseSideTaper;
        }

        // 4. Upper Lip (v ≈ 0.64..0.69)
        if (v >= 0.64 && v <= 0.69 && Math.abs(phi) < 0.35) {
          const lipPower = Math.sin(((v - 0.64) / 0.05) * Math.PI);
          zOffset += headRadius * 0.08 * lipPower;
          upperLipIndices.push(positions.length / 3);
        }

        // 5. Mouth cleft seam (v ≈ 0.69..0.73)
        if (v >= 0.69 && v <= 0.73 && Math.abs(phi) < 0.4) {
          zOffset -= headRadius * 0.06;
          // Mouth corners
          if (Math.abs(phi) > 0.22 && Math.abs(phi) < 0.38) {
            if (sinP < 0) mouthCornerLeftIndices.push(positions.length / 3);
            else mouthCornerRightIndices.push(positions.length / 3);
          }
        }

        // 6. Lower Lip & Chin (v ≈ 0.73..0.85)
        if (v >= 0.73 && v <= 0.85 && Math.abs(phi) < 0.4) {
          // Lower lip
          if (v < 0.78) {
            zOffset += headRadius * 0.07 * Math.sin(((v - 0.73) / 0.05) * Math.PI);
            lowerLipChinIndices.push(positions.length / 3);
          } else {
            // Chin forward protrusion
            const chinPower = Math.sin(((v - 0.78) / 0.07) * Math.PI);
            zOffset += headRadius * 0.16 * chinPower * centerWeight;
            yOffset += headRadius * 0.04 * chinPower;
            lowerLipChinIndices.push(positions.length / 3);
          }
        }
      }

      const vertX = headPos.x + rad * sinP + xOffset;
      const vertY = headPos.y + yRel + yOffset;
      const vertZ = headPos.z + rad * cosP + zOffset;

      positions.push(vertX, vertY, vertZ);

      // Normal approximation
      scratchDir.set(rad * sinP, yRel, rad * cosP).normalize();
      normals.push(scratchDir.x, scratchDir.y, scratchDir.z);

      colors.push(skinRgb[0], skinRgb[1], skinRgb[2]);
      skinIndices.push(idxHead, idxJaw, 0, 0);

      // Vertices near chin/jaw are partially weighted to jaw
      const jawWeight = (v > 0.72 && cosP > 0.2) ? 0.65 : 0;
      skinWeights.push(1 - jawWeight, jawWeight, 0, 0);
    }
  }

  // Head indices
  for (let r = 0; r < numHeadRings; r++) {
    for (let s = 0; s < numHeadSlices; s++) {
      const first = headStartVertex + r * (numHeadSlices + 1) + s;
      const second = first + numHeadSlices + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Stylized Hair Volume (Strictly above brow: v in [0..0.34] and back of head)
  // -------------------------------------------------------------------------
  const hairStartVertex = positions.length / 3;
  const numHairRings = 6;
  const hairRadius = headRadius * 1.05;

  for (let r = 0; r <= numHairRings; r++) {
    const v = (r / numHairRings) * 0.55; // covers crown down to just above brow and occiput
    const baseCos = Math.cos(v * Math.PI);
    const baseSin = Math.sin(v * Math.PI);

    for (let s = 0; s <= numHeadSlices; s++) {
      const u = s / numHeadSlices;
      const phi = u * Math.PI * 2 - Math.PI;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      // Front hair stops at hairline (v <= 0.32 in front, reaches lower in back)
      let effectiveV = v;
      if (cosP > 0.1 && v > 0.33) {
        effectiveV = 0.33; // clamp hairline above eyes
      }

      const rad = hairRadius * Math.sin(effectiveV * Math.PI);
      const yRel = Math.cos(effectiveV * Math.PI) * hairRadius;

      positions.push(
        headPos.x + rad * sinP,
        headPos.y + yRel,
        headPos.z + rad * cosP,
      );
      normals.push(sinP, yRel / hairRadius, cosP);
      colors.push(hairRgb[0], hairRgb[1], hairRgb[2]);
      skinIndices.push(idxHead, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }

  for (let r = 0; r < numHairRings; r++) {
    for (let s = 0; s < numHeadSlices; s++) {
      const first = hairStartVertex + r * (numHeadSlices + 1) + s;
      const second = first + numHeadSlices + 1;
      indices.push(first, first + 1, second);
      indices.push(second, first + 1, second + 1);
    }
  }

  // -------------------------------------------------------------------------
  // Stylized Recessed Eyes (Inside the orbital sockets beneath the brow)
  // -------------------------------------------------------------------------
  const eyeRadius = headRadius * 0.12;
  const eyeY = headPos.y + headRadius * 0.05;
  const eyeZ = headPos.z + headRadius * 0.82;
  const eyeXOffset = headRadius * 0.30;

  const leftEyeCenter = new Vector3(headPos.x - eyeXOffset, eyeY, eyeZ);
  const rightEyeCenter = new Vector3(headPos.x + eyeXOffset, eyeY, eyeZ);

  appendEyeSphere(positions, normals, colors, skinIndices, skinWeights, indices, leftEyeCenter, eyeRadius, eyesRgb, idxLeftEye);
  appendEyeSphere(positions, normals, colors, skinIndices, skinWeights, indices, rightEyeCenter, eyeRadius, eyesRgb, idxRightEye);

  // =========================================================================
  // 2. NECK & VILLAGER TUNIC (Torso, Shoulders, Belt, Skirt)
  // =========================================================================
  const hipWidth = Math.max(0.12, leftUpperLegPos.distanceTo(rightUpperLegPos));
  const pelvisRadius = hipWidth * 0.54;
  const chestWidth = Math.max(0.18, leftShoulderPos.distanceTo(rightShoulderPos));
  const chestRadius = chestWidth * 0.44;

  // Neck (Neck bone -> Head base)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    neckPos,
    new Vector3(headPos.x, headPos.y - headRadius * 0.72, headPos.z),
    headRadius * 0.45,
    headRadius * 0.40,
    skinRgb,
    idxNeck,
    idxHead,
    8,
    true,
  );

  // Chest / Shoulders with Tunic (Chest -> Neck) with V-neck skin collar
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    chestPos,
    neckPos,
    chestRadius,
    chestRadius * 0.65,
    torsoRgb,
    idxChest,
    idxNeck,
    10,
    true,
  );

  // Mid Torso (Spine -> Chest)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    spinePos,
    chestPos,
    pelvisRadius * 0.92,
    chestRadius,
    torsoRgb,
    idxSpine,
    idxChest,
    10,
    true,
  );

  // Waist Belt (Contrasting leather band around spine)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    new Vector3(spinePos.x, spinePos.y - 0.03, spinePos.z),
    new Vector3(spinePos.x, spinePos.y + 0.03, spinePos.z),
    pelvisRadius * 0.96,
    pelvisRadius * 0.96,
    beltRgb,
    idxSpine,
    idxSpine,
    10,
    false,
  );

  // Pelvis & Flared Tunic Skirt (Hips -> Spine & extending down over upper thighs)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    new Vector3(hipsPos.x, hipsPos.y - 0.12, hipsPos.z),
    spinePos,
    pelvisRadius * 1.15, // Flared tunic skirt hem
    pelvisRadius * 0.94,
    torsoRgb,
    idxHips,
    idxSpine,
    10,
    true,
  );

  // =========================================================================
  // 3. ARMS & HANDS (Tunic Sleeves + Skin Forearms)
  // =========================================================================
  const armRadius = Math.max(0.035, chestRadius * 0.36);

  // Left Arm (Clavicle / Shoulder)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    chestPos, leftShoulderPos,
    armRadius * 1.15, armRadius * 1.05,
    torsoRgb, idxChest, idxChest, 8, false,
  );
  // Left Upper Arm (Tunic sleeve on upper half, skin on elbow)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftUpperArmPos, leftLowerArmPos,
    armRadius * 1.05, armRadius * 0.85,
    torsoRgb, idxLeftUpperArm, idxLeftLowerArm, 8, true,
  );
  // Left Forearm (Skin)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftLowerArmPos, leftHandPos,
    armRadius * 0.85, armRadius * 0.70,
    skinRgb, idxLeftLowerArm, idxLeftHand, 8, true,
  );
  // Left Hand
  appendVillagerHand(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftHandPos, leftLowerArmPos, armRadius * 0.75, fingerCount, skinRgb, idxLeftHand, -1,
  );

  // Right Arm (Clavicle / Shoulder)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    chestPos, rightShoulderPos,
    armRadius * 1.15, armRadius * 1.05,
    torsoRgb, idxChest, idxChest, 8, false,
  );
  // Right Upper Arm
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightUpperArmPos, rightLowerArmPos,
    armRadius * 1.05, armRadius * 0.85,
    torsoRgb, idxRightUpperArm, idxRightLowerArm, 8, true,
  );
  // Right Forearm
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightLowerArmPos, rightHandPos,
    armRadius * 0.85, armRadius * 0.70,
    skinRgb, idxRightLowerArm, idxRightHand, 8, true,
  );
  // Right Hand
  appendVillagerHand(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightHandPos, rightLowerArmPos, armRadius * 0.75, fingerCount, skinRgb, idxRightHand, 1,
  );

  // =========================================================================
  // 4. LEGS & LEATHER SHOES (Trousers + Leather Turn-Shoes)
  // =========================================================================
  const legRadius = Math.max(0.048, pelvisRadius * 0.48);

  // Left Thigh (under tunic skirt)
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftUpperLegPos, leftLowerLegPos,
    legRadius, legRadius * 0.82,
    legsRgb, idxLeftUpperLeg, idxLeftLowerLeg, 8, true,
  );
  // Left Calf / Shin
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftLowerLegPos, leftFootPos,
    legRadius * 0.82, legRadius * 0.68,
    legsRgb, idxLeftLowerLeg, idxLeftFoot, 8, true,
  );
  // Left Leather Shoe
  appendVillagerShoe(
    positions, normals, colors, skinIndices, skinWeights, indices,
    leftFootPos, leftToesPos, legRadius * 0.72, feetRgb, idxLeftFoot, idxLeftToes,
  );

  // Right Thigh
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightUpperLegPos, rightLowerLegPos,
    legRadius, legRadius * 0.82,
    legsRgb, idxRightUpperLeg, idxRightLowerLeg, 8, true,
  );
  // Right Calf / Shin
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightLowerLegPos, rightFootPos,
    legRadius * 0.82, legRadius * 0.68,
    legsRgb, idxRightLowerLeg, idxRightFoot, 8, true,
  );
  // Right Leather Shoe
  appendVillagerShoe(
    positions, normals, colors, skinIndices, skinWeights, indices,
    rightFootPos, rightToesPos, legRadius * 0.72, feetRgb, idxRightFoot, idxRightToes,
  );

  const triangleCount = indices.length / 3;
  if (triangleCount > maxTriangles || triangleCount > CHARACTER_MAX_TRIANGLES_PER_MESH) {
    throw new RangeError(
      `Villager mesh triangle count (${triangleCount}) exceeds budget (${Math.min(maxTriangles, CHARACTER_MAX_TRIANGLES_PER_MESH)}).`,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);

  // -------------------------------------------------------------------------
  // 5. ARKit BLENDSHAPE MORPH TARGETS (Real Mouth Cleft & Eyelids)
  // -------------------------------------------------------------------------
  if (includeFaceMorphs) {
    buildVillagerFaceMorphs(
      geometry,
      positions,
      headRadius,
      lowerLipChinIndices,
      upperLipIndices,
      mouthCornerLeftIndices,
      mouthCornerRightIndices,
      leftBrowIndices,
      rightBrowIndices,
      leftEyelidIndices,
      rightEyelidIndices,
    );
  }

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: options?.roughness ?? 0.75,
    metalness: options?.metalness ?? 0.05,
  });

  const mesh = new SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new Matrix4().identity());
  mesh.name = options?.id ?? 'villager-body-mesh';

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

function buildVillagerFaceMorphs(
  geometry: BufferGeometry,
  basePositions: readonly number[],
  headRadius: number,
  lowerLipChin: readonly number[],
  upperLip: readonly number[],
  mouthLeft: readonly number[],
  mouthRight: readonly number[],
  browLeft: readonly number[],
  browRight: readonly number[],
  eyelidLeft: readonly number[],
  eyelidRight: readonly number[],
): void {
  const count = basePositions.length / 3;

  const createDelta = (applyFn: (idx: number, delta: [number, number, number]) => void): Float32BufferAttribute => {
    const arr = new Float32Array(count * 3);
    const d: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      d[0] = 0;
      d[1] = 0;
      d[2] = 0;
      applyFn(i, d);
      arr[i * 3] = d[0];
      arr[i * 3 + 1] = d[1];
      arr[i * 3 + 2] = d[2];
    }
    return new Float32BufferAttribute(arr, 3);
  };

  const lowerSet = new Set(lowerLipChin);
  const upperSet = new Set(upperLip);
  const mouthLeftSet = new Set(mouthLeft);
  const mouthRightSet = new Set(mouthRight);
  const browLeftSet = new Set(browLeft);
  const browRightSet = new Set(browRight);
  const eyelidLeftSet = new Set(eyelidLeft);
  const eyelidRightSet = new Set(eyelidRight);

  // 1. jawOpen: lower lip & chin drop down and back into throat
  const jawOpenAttr = createDelta((idx, d) => {
    if (lowerSet.has(idx)) {
      d[1] = -headRadius * 0.32;
      d[2] = -headRadius * 0.08;
    }
    if (upperSet.has(idx)) {
      d[1] = headRadius * 0.05;
    }
  });

  // 2. mouthOpen: lips part cleanly
  const mouthOpenAttr = createDelta((idx, d) => {
    if (lowerSet.has(idx)) {
      d[1] = -headRadius * 0.22;
      d[2] = -headRadius * 0.04;
    }
    if (upperSet.has(idx)) {
      d[1] = headRadius * 0.04;
    }
  });

  // 3. mouthSmile: mouth corners pull back and up into cheeks
  const mouthSmileAttr = createDelta((idx, d) => {
    if (mouthLeftSet.has(idx)) {
      d[0] = -headRadius * 0.08;
      d[1] = headRadius * 0.12;
      d[2] = -headRadius * 0.02;
    }
    if (mouthRightSet.has(idx)) {
      d[0] = headRadius * 0.08;
      d[1] = headRadius * 0.12;
      d[2] = -headRadius * 0.02;
    }
    if (upperSet.has(idx)) {
      d[1] = headRadius * 0.04;
    }
  });

  // 4. eyeBlinkLeft
  const eyeBlinkLeftAttr = createDelta((idx, d) => {
    if (eyelidLeftSet.has(idx)) {
      d[1] = -headRadius * 0.09;
      d[2] = headRadius * 0.02;
    }
  });

  // 5. eyeBlinkRight
  const eyeBlinkRightAttr = createDelta((idx, d) => {
    if (eyelidRightSet.has(idx)) {
      d[1] = -headRadius * 0.09;
      d[2] = headRadius * 0.02;
    }
  });

  // 6. browDownLeft
  const browDownLeftAttr = createDelta((idx, d) => {
    if (browLeftSet.has(idx)) {
      d[0] = headRadius * 0.03;
      d[1] = -headRadius * 0.11;
    }
  });

  // 7. browDownRight
  const browDownRightAttr = createDelta((idx, d) => {
    if (browRightSet.has(idx)) {
      d[0] = -headRadius * 0.03;
      d[1] = -headRadius * 0.11;
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

      scratchNorm.copy(scratchPerp).multiplyScalar(cosA).addScaledVector(scratchUp, sinA);
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

function appendEyeSphere(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  center: Vector3,
  radius: number,
  irisRgb: readonly [number, number, number],
  boneIdx: number,
): void {
  const baseIdx = positions.length / 3;
  const segments = 6;
  const scleraRgb = [0.96, 0.96, 0.98] as const;

  // Small forward-facing hemispherical eye
  for (let y = 0; y <= segments; y++) {
    const v = y / segments;
    const theta = v * Math.PI * 0.5; // front hemisphere only
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const phi = u * Math.PI * 2;
      const nx = sinT * Math.sin(phi);
      const ny = sinT * Math.cos(phi);
      const nz = cosT; // facing +Z

      positions.push(center.x + radius * nx, center.y + radius * ny, center.z + radius * nz);
      normals.push(nx, ny, nz);

      // Center is dark pupil/iris, perimeter is white sclera
      const isIris = sinT < 0.45;
      const rgb = isIris ? irisRgb : scleraRgb;
      colors.push(rgb[0], rgb[1], rgb[2]);

      skinIndices.push(boneIdx, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }

  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const first = baseIdx + y * (segments + 1) + x;
      const second = first + segments + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }
}

function appendVillagerHand(
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
  sideSign: number,
): void {
  scratchDir.subVectors(handPos, elbowPos).normalize();
  scratchPerp.set(sideSign, 0, 0);
  scratchUp.crossVectors(scratchDir, scratchPerp).normalize();

  // Palm: beveled block
  const palmCenter = new Vector3().copy(handPos).addScaledVector(scratchDir, handRadius * 0.75);
  appendBox(
    positions, normals, colors, skinIndices, skinWeights, indices,
    palmCenter,
    new Vector3(handRadius * 1.25, handRadius * 1.35, handRadius * 0.55),
    rgb,
    boneIdx,
  );

  // Angled thumb
  const thumbBase = new Vector3()
    .copy(palmCenter)
    .addScaledVector(scratchPerp, -sideSign * handRadius * 0.65)
    .addScaledVector(scratchUp, handRadius * 0.15);
  const thumbTip = new Vector3()
    .copy(thumbBase)
    .addScaledVector(scratchPerp, -sideSign * handRadius * 0.45)
    .addScaledVector(scratchDir, handRadius * 0.48);
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    thumbBase, thumbTip,
    handRadius * 0.28, handRadius * 0.18,
    rgb, boneIdx, boneIdx, 4, false,
  );

  if (fingerCount === 0) {
    // Mitten paddle
    const paddleTip = new Vector3().copy(palmCenter).addScaledVector(scratchDir, handRadius * 1.15);
    appendTaperedLimb(
      positions, normals, colors, skinIndices, skinWeights, indices,
      palmCenter, paddleTip,
      handRadius * 0.58, handRadius * 0.38,
      rgb, boneIdx, boneIdx, 4, false,
    );
  } else {
    // Stylized low-poly fingers
    const fingers = Math.min(5, Math.max(1, fingerCount));
    const active = fingers === 5 ? 4 : fingers;
    const spacing = (handRadius * 1.05) / Math.max(1, active);
    const len = handRadius * 0.85;

    for (let f = 0; f < active; f++) {
      const offset = (f - (active - 1) * 0.5) * spacing;
      const fBase = new Vector3()
        .copy(palmCenter)
        .addScaledVector(scratchPerp, offset)
        .addScaledVector(scratchDir, handRadius * 0.68);
      const fTip = new Vector3().copy(fBase).addScaledVector(scratchDir, len);
      appendTaperedLimb(
        positions, normals, colors, skinIndices, skinWeights, indices,
        fBase, fTip,
        handRadius * 0.20, handRadius * 0.14,
        rgb, boneIdx, boneIdx, 4, false,
      );
    }
  }
}

function appendVillagerShoe(
  positions: number[],
  normals: number[],
  colors: number[],
  skinIndices: number[],
  skinWeights: number[],
  indices: number[],
  footPos: Vector3,
  toesPos: Vector3,
  shoeRadius: number,
  rgb: readonly [number, number, number],
  boneFootIdx: number,
  boneToesIdx: number,
): void {
  const heelCenter = new Vector3(footPos.x, footPos.y + shoeRadius * 0.45, footPos.z - shoeRadius * 0.4);
  const toeCenter = new Vector3(toesPos.x, toesPos.y + shoeRadius * 0.35, toesPos.z);

  // Main leather turn-shoe body
  appendTaperedLimb(
    positions, normals, colors, skinIndices, skinWeights, indices,
    heelCenter, toeCenter,
    shoeRadius * 0.95, shoeRadius * 0.75,
    rgb, boneFootIdx, boneToesIdx, 6, true,
  );

  // Beveled leather toe box
  appendBox(
    positions, normals, colors, skinIndices, skinWeights, indices,
    toeCenter,
    new Vector3(shoeRadius * 1.35, shoeRadius * 0.70, shoeRadius * 0.85),
    rgb,
    boneToesIdx,
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
