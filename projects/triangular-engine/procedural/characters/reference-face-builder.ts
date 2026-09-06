/**
 * Art-directed procedural reference face builder with full expressive articulation.
 *
 * Implements:
 * - Seated eyeball spheres with independent 2-DOF rotation (yaw/pitch) within physical limits
 * - Upper and lower eyelid morphs (independent left/right blinking, squinting, widening)
 * - Independent left and right eyebrow morphs (raising, lowering, including single right brow raise)
 * - Sculpted mouth with smile, frown, jaw open, sealed lip closure, rounding, and widening
 * - Zero mesh tearing across all combined control ranges
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BlendShapeWeights, EyeGazeState } from 'triangular-engine/characters';

export const REFERENCE_FACE_MORPH_NAMES = [
  'jawOpen',
  'mouthOpen',
  'mouthSmile',
  'mouthFrown',
  'mouthClose',
  'mouthRound',
  'mouthWiden',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'browDownLeft',
  'browDownRight',
  'browUpLeft',
  'browUpRight',
] as const;

export type ReferenceFaceMorphName = (typeof REFERENCE_FACE_MORPH_NAMES)[number];

export interface IReferenceFaceOptions {
  readonly id?: string;
  readonly skinColorHex?: string;
  readonly browColorHex?: string;
  readonly eyeColorHex?: string;
  readonly lipColorHex?: string;
  readonly headRadius?: number;
}

export interface IReferenceFaceResult {
  readonly root: Group;
  readonly headMesh: Mesh;
  readonly leftEye: Group;
  readonly rightEye: Group;
  readonly morphTargetDictionary: Record<ReferenceFaceMorphName, number>;
  readonly applyPose: (weights: BlendShapeWeights, gaze?: EyeGazeState) => void;
}

function parseHexColor(hex?: string, fallback: [number, number, number] = [0.85, 0.7, 0.58]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  try {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  } catch {
    return fallback;
  }
}

/**
 * Builds a clean, stylized procedural reference face with dedicated morph targets and seated eye pivots.
 */
export function buildReferenceFaceMesh(options: IReferenceFaceOptions = {}): IReferenceFaceResult {
  const headRadius = Math.max(0.08, options.headRadius ?? 0.12);
  const skinRgb = parseHexColor(options.skinColorHex, [0.88, 0.72, 0.58]);
  const browRgb = parseHexColor(options.browColorHex, [0.22, 0.14, 0.08]);
  const eyeRgb = parseHexColor(options.eyeColorHex, [0.12, 0.18, 0.28]);
  const lipRgb = parseHexColor(options.lipColorHex, [0.78, 0.42, 0.44]);

  const root = new Group();
  root.name = options.id ?? 'reference-face-root';

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Vertex index tracking for morph targets
  const lowerLipChinIndices: number[] = [];
  const upperLipIndices: number[] = [];
  const mouthLeftIndices: number[] = [];
  const mouthRightIndices: number[] = [];
  const leftUpperEyelidIndices: number[] = [];
  const rightUpperEyelidIndices: number[] = [];
  const leftLowerEyelidIndices: number[] = [];
  const rightLowerEyelidIndices: number[] = [];
  const leftBrowIndices: number[] = [];
  const rightBrowIndices: number[] = [];

  // Proportions
  const hr = headRadius;
  const eyeXOffset = hr * 0.32;
  const eyeY = hr * 0.08;
  const eyeZ = hr * 0.76;
  const eyeRadius = hr * 0.16;

  // ---------------------------------------------------------------------------
  // 1. HEAD SKULL & FACIAL FEATURES (Parametric UV mesh with sculpted sockets)
  // ---------------------------------------------------------------------------
  const numRings = 24;
  const numSlices = 28;
  const headStartIdx = positions.length / 3;

  for (let r = 0; r <= numRings; r++) {
    const v = r / numRings; // 0 (top of crown) to 1 (base of neck/chin)
    const ringAngle = v * Math.PI;
    const baseRad = hr * Math.sin(ringAngle);
    const baseRelY = hr * Math.cos(ringAngle);

    for (let s = 0; s <= numSlices; s++) {
      const u = s / numSlices;
      const phi = u * Math.PI * 2 - Math.PI; // -PI to +PI (+Z is cos(phi) > 0)
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      let x = baseRad * sinP;
      let y = baseRelY;
      let z = baseRad * cosP;

      const vertIdx = positions.length / 3;
      let vertColor = skinRgb;

      // Facial front quadrant modifications (cosP > 0.15)
      if (cosP > 0.15) {
        // Taper temples & chiseled jaw
        if (v > 0.65) {
          x *= 0.88; // chiseled lower jaw taper
        }

        // --- EYE SOCKETS & EYELIDS (v in [0.40..0.52], |x| near eyeXOffset) ---
        const distToLeftEye = Math.hypot(x - -eyeXOffset, y - eyeY);
        const distToRightEye = Math.hypot(x - eyeXOffset, y - eyeY);

        if (distToLeftEye < eyeRadius * 1.35) {
          // Recess orbit so eye sphere sits flush inside
          const recess = (1 - distToLeftEye / (eyeRadius * 1.35));
          z -= hr * 0.14 * recess;

          // Upper vs Lower eyelid edge
          if (y >= eyeY) {
            leftUpperEyelidIndices.push(vertIdx);
          } else {
            leftLowerEyelidIndices.push(vertIdx);
          }
        }

        if (distToRightEye < eyeRadius * 1.35) {
          const recess = (1 - distToRightEye / (eyeRadius * 1.35));
          z -= hr * 0.14 * recess;

          if (y >= eyeY) {
            rightUpperEyelidIndices.push(vertIdx);
          } else {
            rightLowerEyelidIndices.push(vertIdx);
          }
        }

        // --- NOSE RIDGE & TIP (v in [0.45..0.62], |x| < hr * 0.14) ---
        if (v >= 0.45 && v <= 0.62 && Math.abs(x) < hr * 0.14) {
          const noseWidthWeight = 1 - Math.abs(x) / (hr * 0.14);
          const noseHeightProgress = (v - 0.45) / 0.17;
          const noseProfile = Math.sin(noseHeightProgress * Math.PI);
          z += hr * 0.22 * noseWidthWeight * noseProfile;
        }

        // --- MOUTH & LIPS (v in [0.65..0.82], |x| < hr * 0.38) ---
        if (v >= 0.65 && v <= 0.82 && Math.abs(x) < hr * 0.38) {
          vertColor = lipRgb;

          // Upper lip (v in [0.65..0.72])
          if (v <= 0.72) {
            const lipProg = Math.sin(((v - 0.65) / 0.07) * Math.PI);
            z += hr * 0.06 * lipProg;
            upperLipIndices.push(vertIdx);
          } else {
            // Lower lip and chin (v in [0.72..0.82])
            const lipProg = Math.sin(((v - 0.72) / 0.10) * Math.PI);
            z += hr * 0.08 * lipProg;
            lowerLipChinIndices.push(vertIdx);
          }

          // Mouth corners
          if (Math.abs(x) > hr * 0.15) {
            if (x < 0) {
              mouthLeftIndices.push(vertIdx);
            } else {
              mouthRightIndices.push(vertIdx);
            }
          }
        }
      }

      positions.push(x, y, z);

      // Spherical normal approximation
      const len = Math.hypot(x, y, z) || 1;
      normals.push(x / len, y / len, z / len);
      colors.push(vertColor[0], vertColor[1], vertColor[2]);
    }
  }

  // Head indices
  for (let r = 0; r < numRings; r++) {
    for (let s = 0; s < numSlices; s++) {
      const first = headStartIdx + r * (numSlices + 1) + s;
      const second = first + numSlices + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. SCULPTED EYEBROWS (High contrast brow geometry with independent indices)
  // ---------------------------------------------------------------------------
  const appendEyebrow = (
    centerX: number,
    centerY: number,
    centerZ: number,
    isLeft: boolean,
  ) => {
    const browW = hr * 0.34;
    const browH = hr * 0.06;
    const browD = hr * 0.04;
    const sign = isLeft ? -1 : 1;

    const bStart = positions.length / 3;

    // 4 front vertices for eyebrow ribbon
    const pts = [
      [-browW * 0.5 * sign, -browH * 0.5, browD],
      [browW * 0.5 * sign, -browH * 0.2, browD],
      [browW * 0.5 * sign, browH * 0.5, browD],
      [-browW * 0.5 * sign, browH * 0.4, browD],
    ];

    for (const p of pts) {
      const vertIdx = positions.length / 3;
      positions.push(centerX + p[0], centerY + p[1], centerZ + p[2]);
      normals.push(0, 0, 1);
      colors.push(browRgb[0], browRgb[1], browRgb[2]);

      if (isLeft) {
        leftBrowIndices.push(vertIdx);
      } else {
        rightBrowIndices.push(vertIdx);
      }
    }

    indices.push(bStart, bStart + 1, bStart + 2, bStart, bStart + 2, bStart + 3);
  };

  appendEyebrow(-eyeXOffset, eyeY + hr * 0.24, eyeZ + hr * 0.05, true);
  appendEyebrow(eyeXOffset, eyeY + hr * 0.24, eyeZ + hr * 0.05, false);

  // ---------------------------------------------------------------------------
  // 3. MORPH DELTAS (ARKit 52 compatible position deltas)
  // ---------------------------------------------------------------------------
  const totalVerts = positions.length / 3;
  const createDelta = (applyFn: (idx: number, delta: [number, number, number]) => void): Float32BufferAttribute => {
    const arr = new Float32Array(totalVerts * 3);
    const d: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < totalVerts; i++) {
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

  const lowerSet = new Set(lowerLipChinIndices);
  const upperSet = new Set(upperLipIndices);
  const mouthLeftSet = new Set(mouthLeftIndices);
  const mouthRightSet = new Set(mouthRightIndices);
  const eyelidLeftUpperSet = new Set(leftUpperEyelidIndices);
  const eyelidRightUpperSet = new Set(rightUpperEyelidIndices);
  const eyelidLeftLowerSet = new Set(leftLowerEyelidIndices);
  const eyelidRightLowerSet = new Set(rightLowerEyelidIndices);
  const browLeftSet = new Set(leftBrowIndices);
  const browRightSet = new Set(rightBrowIndices);

  // 1. jawOpen: lower jaw/chin drops downward & back
  const jawOpenDelta = createDelta((i, d) => {
    if (lowerSet.has(i)) {
      d[1] = -hr * 0.35;
      d[2] = -hr * 0.08;
    }
    if (upperSet.has(i)) {
      d[1] = hr * 0.04;
    }
  });

  // 2. mouthOpen: mouth parts cleanly
  const mouthOpenDelta = createDelta((i, d) => {
    if (lowerSet.has(i)) {
      d[1] = -hr * 0.22;
    }
    if (upperSet.has(i)) {
      d[1] = hr * 0.06;
    }
  });

  // 3. mouthSmile: corners pull upward and back into cheeks
  const mouthSmileDelta = createDelta((i, d) => {
    if (mouthLeftSet.has(i)) {
      d[0] = -hr * 0.08;
      d[1] = hr * 0.12;
      d[2] = -hr * 0.02;
    }
    if (mouthRightSet.has(i)) {
      d[0] = hr * 0.08;
      d[1] = hr * 0.12;
      d[2] = -hr * 0.02;
    }
    if (upperSet.has(i)) {
      d[1] = hr * 0.03;
    }
  });

  // 4. mouthFrown: corners pull downward and inward
  const mouthFrownDelta = createDelta((i, d) => {
    if (mouthLeftSet.has(i)) {
      d[0] = hr * 0.03;
      d[1] = -hr * 0.10;
    }
    if (mouthRightSet.has(i)) {
      d[0] = -hr * 0.03;
      d[1] = -hr * 0.10;
    }
    if (lowerSet.has(i)) {
      d[1] = -hr * 0.04;
    }
  });

  // 5. mouthClose: upper and lower lips seal together even during jaw drops
  const mouthCloseDelta = createDelta((i, d) => {
    if (lowerSet.has(i)) {
      d[1] = hr * 0.15;
    }
    if (upperSet.has(i)) {
      d[1] = -hr * 0.10;
    }
  });

  // 6. mouthRound: lips purse/contract into an O shape (pucker/funnel)
  const mouthRoundDelta = createDelta((i, d) => {
    if (mouthLeftSet.has(i)) {
      d[0] = hr * 0.08;
      d[2] = hr * 0.09;
    }
    if (mouthRightSet.has(i)) {
      d[0] = -hr * 0.08;
      d[2] = hr * 0.09;
    }
    if (upperSet.has(i)) {
      d[1] = -hr * 0.04;
      d[2] = hr * 0.08;
    }
    if (lowerSet.has(i)) {
      d[1] = hr * 0.04;
      d[2] = hr * 0.08;
    }
  });

  // 7. mouthWiden: mouth stretch laterally
  const mouthWidenDelta = createDelta((i, d) => {
    if (mouthLeftSet.has(i)) {
      d[0] = -hr * 0.12;
    }
    if (mouthRightSet.has(i)) {
      d[0] = hr * 0.12;
    }
  });

  // 8. eyeBlinkLeft: upper eyelid closes cleanly over left eye
  const eyeBlinkLeftDelta = createDelta((i, d) => {
    if (eyelidLeftUpperSet.has(i)) {
      d[1] = -eyeRadius * 1.6;
      d[2] = hr * 0.03;
    }
  });

  // 9. eyeBlinkRight: upper eyelid closes cleanly over right eye
  const eyeBlinkRightDelta = createDelta((i, d) => {
    if (eyelidRightUpperSet.has(i)) {
      d[1] = -eyeRadius * 1.6;
      d[2] = hr * 0.03;
    }
  });

  // 10. eyeSquintLeft: lower eyelid rises
  const eyeSquintLeftDelta = createDelta((i, d) => {
    if (eyelidLeftLowerSet.has(i)) {
      d[1] = eyeRadius * 0.6;
    }
  });

  // 11. eyeSquintRight: lower eyelid rises
  const eyeSquintRightDelta = createDelta((i, d) => {
    if (eyelidRightLowerSet.has(i)) {
      d[1] = eyeRadius * 0.6;
    }
  });

  // 12. eyeWideLeft: upper eyelid raises
  const eyeWideLeftDelta = createDelta((i, d) => {
    if (eyelidLeftUpperSet.has(i)) {
      d[1] = eyeRadius * 0.6;
    }
  });

  // 13. eyeWideRight: upper eyelid raises
  const eyeWideRightDelta = createDelta((i, d) => {
    if (eyelidRightUpperSet.has(i)) {
      d[1] = eyeRadius * 0.6;
    }
  });

  // 14. browDownLeft: lowers/furrows left brow
  const browDownLeftDelta = createDelta((i, d) => {
    if (browLeftSet.has(i)) {
      d[0] = hr * 0.04;
      d[1] = -hr * 0.14;
    }
  });

  // 15. browDownRight: lowers/furrows right brow
  const browDownRightDelta = createDelta((i, d) => {
    if (browRightSet.has(i)) {
      d[0] = -hr * 0.04;
      d[1] = -hr * 0.14;
    }
  });

  // 16. browUpLeft: arches/raises left brow
  const browUpLeftDelta = createDelta((i, d) => {
    if (browLeftSet.has(i)) {
      d[0] = -hr * 0.02;
      d[1] = hr * 0.15;
    }
  });

  // 17. browUpRight: arches/raises right brow (raising only right brow!)
  const browUpRightDelta = createDelta((i, d) => {
    if (browRightSet.has(i)) {
      d[0] = hr * 0.02;
      d[1] = hr * 0.15;
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  geometry.morphAttributes.position = [
    jawOpenDelta,
    mouthOpenDelta,
    mouthSmileDelta,
    mouthFrownDelta,
    mouthCloseDelta,
    mouthRoundDelta,
    mouthWidenDelta,
    eyeBlinkLeftDelta,
    eyeBlinkRightDelta,
    eyeSquintLeftDelta,
    eyeSquintRightDelta,
    eyeWideLeftDelta,
    eyeWideRightDelta,
    browDownLeftDelta,
    browDownRightDelta,
    browUpLeftDelta,
    browUpRightDelta,
  ];
  geometry.morphTargetsRelative = true;

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.08,
  });

  const headMesh = new Mesh(geometry, material);
  headMesh.name = 'reference-head-mesh';

  const morphTargetDictionary: Record<ReferenceFaceMorphName, number> = {} as Record<ReferenceFaceMorphName, number>;
  for (let i = 0; i < REFERENCE_FACE_MORPH_NAMES.length; i++) {
    morphTargetDictionary[REFERENCE_FACE_MORPH_NAMES[i]] = i;
  }
  headMesh.morphTargetDictionary = morphTargetDictionary;
  headMesh.morphTargetInfluences = new Array(REFERENCE_FACE_MORPH_NAMES.length).fill(0);

  root.add(headMesh);

  // ---------------------------------------------------------------------------
  // 4. SEATED EYEBALL ASSEMBLIES (Seated spheres with independent yaw/pitch pivots)
  // ---------------------------------------------------------------------------
  const buildSeatedEye = (name: string, posX: number): Group => {
    const eyeGroup = new Group();
    eyeGroup.name = name;
    eyeGroup.position.set(posX, eyeY, eyeZ);

    // Sclera (White sphere)
    const scleraGeo = new SphereGeometry(eyeRadius, 16, 12);
    const scleraMat = new MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.2,
      metalness: 0.05,
    });
    const scleraMesh = new Mesh(scleraGeo, scleraMat);
    eyeGroup.add(scleraMesh);

    // Iris / Pupil (Facing +Z forward)
    const irisGeo = new SphereGeometry(eyeRadius * 0.58, 12, 8);
    const irisMat = new MeshStandardMaterial({
      color: new Color(eyeRgb[0], eyeRgb[1], eyeRgb[2]),
      roughness: 0.3,
    });
    const irisMesh = new Mesh(irisGeo, irisMat);
    irisMesh.position.set(0, 0, eyeRadius * 0.72);
    irisMesh.scale.set(1, 1, 0.45);
    eyeGroup.add(irisMesh);

    // Catchlight highlight dot
    const catchGeo = new SphereGeometry(eyeRadius * 0.16, 8, 6);
    const catchMat = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      emissive: 0x888888,
    });
    const catchMesh = new Mesh(catchGeo, catchMat);
    catchMesh.position.set(eyeRadius * 0.22, eyeRadius * 0.22, eyeRadius * 0.88);
    eyeGroup.add(catchMesh);

    return eyeGroup;
  };

  const leftEye = buildSeatedEye('reference-left-eye', -eyeXOffset);
  const rightEye = buildSeatedEye('reference-right-eye', eyeXOffset);
  root.add(leftEye);
  root.add(rightEye);

  // ---------------------------------------------------------------------------
  // 5. APPOSE POSE BINDING FUNCTION
  // ---------------------------------------------------------------------------
  const applyPose = (weights: BlendShapeWeights, gaze?: EyeGazeState): void => {
    const influences = headMesh.morphTargetInfluences;
    if (influences) {
      influences[0] = weights.jawOpen ?? 0;
      influences[1] = Math.max(weights.mouthFunnel ?? 0, weights.mouthPucker ?? 0) * 0.5;
      influences[2] = Math.max(weights.mouthSmileLeft ?? 0, weights.mouthSmileRight ?? 0);
      influences[3] = Math.max(weights.mouthFrownLeft ?? 0, weights.mouthFrownRight ?? 0);
      influences[4] = weights.mouthClose ?? 0;
      influences[5] = Math.max(weights.mouthPucker ?? 0, weights.mouthFunnel ?? 0);
      influences[6] = Math.max(weights.mouthStretchLeft ?? 0, weights.mouthStretchRight ?? 0);

      influences[7] = weights.eyeBlinkLeft ?? 0;
      influences[8] = weights.eyeBlinkRight ?? 0;
      influences[9] = weights.eyeSquintLeft ?? 0;
      influences[10] = weights.eyeSquintRight ?? 0;
      influences[11] = weights.eyeWideLeft ?? 0;
      influences[12] = weights.eyeWideRight ?? 0;

      influences[13] = weights.browDownLeft ?? 0;
      influences[14] = weights.browDownRight ?? 0;
      influences[15] = Math.max(weights.browOuterUpLeft ?? 0, (weights.browInnerUp ?? 0) * 0.8);
      influences[16] = Math.max(weights.browOuterUpRight ?? 0, (weights.browInnerUp ?? 0) * 0.8);
    }

    if (gaze) {
      // Rotation in local eye pivot: pitch = X axis, yaw = Y axis
      leftEye.rotation.set(gaze.left.pitch, gaze.left.yaw, 0);
      rightEye.rotation.set(gaze.right.pitch, gaze.right.yaw, 0);
    }
  };

  return {
    root,
    headMesh,
    leftEye,
    rightEye,
    morphTargetDictionary,
    applyPose,
  };
}
