import { Euler, Mesh, Object3D, Quaternion } from 'three';
import {
  ARKIT_BLENDSHAPE_NAMES,
  OCULUS_TO_ARKIT,
  type BlendShapeWeights,
  type BlendshapeName,
} from 'triangular-engine/characters';

const ARKIT_SET = new Set<string>(ARKIT_BLENDSHAPE_NAMES);
const ARKIT_LOWER_MAP = new Map<string, BlendshapeName>();
for (const name of ARKIT_BLENDSHAPE_NAMES) {
  ARKIT_LOWER_MAP.set(name.toLowerCase(), name);
}

/**
 * Normalizes an arbitrary morph target name (e.g. from glTF, FBX, VRM, FaceCap, Blender)
 * to its canonical ARKit 52 blendshape name, if recognized.
 *
 * Supports:
 * - Exact canonical ARKit names (`eyeBlinkLeft`, `mouthSmileRight`)
 * - Suffix variants (`eyeBlink_L`, `eyeBlink_l`, `eyeBlink.L`, `mouthSmile_R`)
 * - Prefixed names (`blendShape1.eyeBlinkLeft`, `BS_jawOpen`, `head.mouthSmile_L`)
 * - Oculus / VRM names (`Eye_Blink_L`, `Jaw_Open`)
 * - Case-insensitive matches
 */
export function normalizeMorphTargetName(rawName: string): BlendshapeName | undefined {
  if (ARKIT_SET.has(rawName)) {
    return rawName as BlendshapeName;
  }

  // Check direct Oculus dictionary match
  const directOculus = (OCULUS_TO_ARKIT as Record<string, BlendshapeName>)[rawName];
  if (directOculus) {
    return directOculus;
  }

  // Strip leading namespace / mesh prefixes (e.g., 'blendShape1.', 'BS_', 'head:', etc.)
  // Avoid stripping dot suffixes like '.R' or '.L' by ensuring the remaining stem is at least 3 characters.
  let clean = rawName;
  const prefixMatch = clean.match(/^[a-zA-Z0-9_]+[:.]([a-zA-Z].*)$/);
  if (prefixMatch && prefixMatch[1].length >= 3) {
    clean = prefixMatch[1];
  }

  if (ARKIT_SET.has(clean)) {
    return clean as BlendshapeName;
  }
  const strippedOculus = (OCULUS_TO_ARKIT as Record<string, BlendshapeName>)[clean];
  if (strippedOculus) {
    return strippedOculus;
  }

  // Replace common left/right suffixes (_L, _R, .L, .R, _left, _right)
  clean = clean
    .replace(/[._]l(eft)?$/i, 'Left')
    .replace(/[._]r(ight)?$/i, 'Right');

  if (ARKIT_SET.has(clean)) {
    return clean as BlendshapeName;
  }

  // Convert snake_case or PascalCase segments to camelCase
  clean = clean.replace(/_([a-zA-Z])/g, (_, c: string) => c.toUpperCase());
  if (clean.length > 0) {
    clean = clean.charAt(0).toLowerCase() + clean.slice(1);
  }

  if (ARKIT_SET.has(clean)) {
    return clean as BlendshapeName;
  }

  // Fallback to lowercase lookup
  return ARKIT_LOWER_MAP.get(clean.toLowerCase());
}

/**
 * Options for binding a 3D character face hierarchy.
 */
export interface CharacterFaceBindingOptions {
  /**
   * Optional custom name for identifying the left eye node.
   * If omitted, common patterns ('grp_eyeLeft', 'eyeLeft', 'Eye_L', 'eye_l', 'Eye.L', 'LeftEye') are checked.
   */
  readonly leftEyeNodeName?: string;

  /**
   * Optional custom name for identifying the right eye node.
   * If omitted, common patterns ('grp_eyeRight', 'eyeRight', 'Eye_R', 'eye_r', 'Eye.R', 'RightEye') are checked.
   */
  readonly rightEyeNodeName?: string;

  /**
   * Whether to drive standard ARKit eye morph targets (`eyeLookUpLeft`, `eyeLookDownLeft`, etc.)
   * when gaze angles are provided.
   *
   * Defaults to `true`.
   */
  readonly driveEyeMorphsFromGaze?: boolean;

  /**
   * Maximum horizontal gaze limit in radians for eye node rotation and morph projection.
   * Defaults to `0.523` (~30 degrees).
   */
  readonly maxGazeYawRad?: number;

  /**
   * Maximum vertical gaze limit in radians for eye node rotation and morph projection.
   * Defaults to `0.349` (~20 degrees).
   */
  readonly maxGazePitchRad?: number;

  /**
   * Horizontal gaze rotation multiplier for eye nodes.
   * In standard Three.js coordinates, looking right (yaw > 0) corresponds to negative Y rotation (-1.0).
   * Defaults to `-1.0`.
   */
  readonly gazeYawMultiplier?: number;

  /**
   * Vertical gaze rotation multiplier for eye nodes.
   * Defaults to `1.0`.
   */
  readonly gazePitchMultiplier?: number;
}

/**
 * Controller interface representing a bound character face mesh in Three.js.
 */
export interface CharacterFaceBinding {
  /** The root Three.js object passed to the binding. */
  readonly root: Object3D;

  /** All child meshes containing morph target dictionaries. */
  readonly morphMeshes: readonly Mesh[];

  /** Identified left eye node, if any. */
  readonly leftEyeNode?: Object3D;

  /** Identified right eye node, if any. */
  readonly rightEyeNode?: Object3D;

  /** Total number of unique canonical blendshapes recognized across all meshes. */
  readonly recognizedMorphCount: number;

  /**
   * Map of recognized canonical blendshape names to their indices per mesh.
   */
  readonly targetDictionary: ReadonlyMap<Mesh, ReadonlyMap<BlendshapeName, number>>;

  /**
   * Applies the given ARKit blendshape weights and gaze angles to the face.
   *
   * @param weights Normalized 0..1 weights keyed by canonical ARKit blendshape names.
   * @param gaze Optional gaze orientation with `yaw` (horizontal) and `pitch` (vertical) in radians.
   */
  applyPose(weights: BlendShapeWeights, gaze?: { yaw: number; pitch: number }): void;

  /**
   * Resets all morph target influences to 0 and restores eye nodes to their rest orientations.
   */
  reset(): void;

  /**
   * Cleanly disposes any cached resources.
   */
  dispose(): void;
}

const DEFAULT_LEFT_EYE_PATTERNS = [
  'grp_eyeleft',
  'eyeleft',
  'eye_l',
  'eye.l',
  'lefteye',
  'left_eye',
  'eyeball_l',
];

const DEFAULT_RIGHT_EYE_PATTERNS = [
  'grp_eyeright',
  'eyeright',
  'eye_r',
  'eye.r',
  'righteye',
  'right_eye',
  'eyeball_r',
];

function findNodeByPattern(
  root: Object3D,
  customName?: string,
  defaultPatterns: readonly string[] = [],
): Object3D | undefined {
  if (customName) {
    let found: Object3D | undefined;
    root.traverse((obj) => {
      if (!found && obj.name === customName) {
        found = obj;
      }
    });
    if (found) return found;
  }

  // Search hierarchy with preference for group pivots first, then child meshes
  const candidates: Object3D[] = [];
  root.traverse((obj) => {
    const lower = obj.name.toLowerCase();
    for (const pattern of defaultPatterns) {
      if (lower === pattern || lower.endsWith(`_${pattern}`) || lower.endsWith(`.${pattern}`)) {
        candidates.push(obj);
        break;
      }
    }
  });

  if (candidates.length === 0) return undefined;
  // If multiple matches (e.g. grp_eyeLeft and eyeLeft), prefer the one starting with grp_
  const groupMatch = candidates.find((c) => c.name.toLowerCase().startsWith('grp_'));
  return groupMatch ?? candidates[0];
}

/**
 * Connects an arbitrary Three.js object hierarchy (GLTF/GLB or procedural) to
 * Triangular Engine's facial animation contracts.
 *
 * Automatically inspects child meshes for ARKit 52 morph targets (handling
 * diverse naming styles like `eyeBlink_L` or `blendShape1.eyeBlinkLeft`) and
 * binds eye pivot nodes for natural gaze tracking.
 */
export function bindCharacterFace(
  root: Object3D,
  options: CharacterFaceBindingOptions = {},
): CharacterFaceBinding {
  const morphMeshes: Mesh[] = [];
  const targetDictionary = new Map<Mesh, Map<BlendshapeName, number>>();
  const allRecognizedNames = new Set<BlendshapeName>();

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      morphMeshes.push(mesh);
      const meshMap = new Map<BlendshapeName, number>();
      for (const [rawName, index] of Object.entries(mesh.morphTargetDictionary)) {
        const canonical = normalizeMorphTargetName(rawName);
        if (canonical) {
          meshMap.set(canonical, index);
          allRecognizedNames.add(canonical);
        }
      }
      targetDictionary.set(mesh, meshMap);
    }
  });

  // Find eye nodes
  const leftEyeNode = findNodeByPattern(root, options.leftEyeNodeName, DEFAULT_LEFT_EYE_PATTERNS);
  const rightEyeNode = findNodeByPattern(root, options.rightEyeNodeName, DEFAULT_RIGHT_EYE_PATTERNS);

  const leftEyeRestQuat = leftEyeNode ? leftEyeNode.quaternion.clone() : undefined;
  const rightEyeRestQuat = rightEyeNode ? rightEyeNode.quaternion.clone() : undefined;

  const driveEyeMorphs = options.driveEyeMorphsFromGaze ?? true;
  const maxYaw = options.maxGazeYawRad ?? 0.523;
  const maxPitch = options.maxGazePitchRad ?? 0.349;
  const yawMult = options.gazeYawMultiplier ?? -1.0;
  const pitchMult = options.gazePitchMultiplier ?? 1.0;

  const euler = new Euler(0, 0, 0, 'YXZ');
  const gazeQuat = new Quaternion();

  const binding: CharacterFaceBinding = {
    root,
    morphMeshes,
    leftEyeNode,
    rightEyeNode,
    recognizedMorphCount: allRecognizedNames.size,
    targetDictionary,

    applyPose(weights: BlendShapeWeights, gaze?: { yaw: number; pitch: number }): void {
      // 1. Prepare combined weights, optionally computing gaze eye morphs
      const effectiveWeights: Record<string, number> = { ...weights };

      if (gaze && driveEyeMorphs) {
        const clampedYaw = Math.max(-maxYaw, Math.min(maxYaw, gaze.yaw));
        const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, gaze.pitch));

        // Horizontal gaze
        if (clampedYaw > 0) {
          // Looking character right
          effectiveWeights['eyeLookInLeft'] = effectiveWeights['eyeLookInLeft'] ?? (clampedYaw / maxYaw);
          effectiveWeights['eyeLookOutRight'] = effectiveWeights['eyeLookOutRight'] ?? (clampedYaw / maxYaw);
        } else if (clampedYaw < 0) {
          // Looking character left
          const mag = -clampedYaw / maxYaw;
          effectiveWeights['eyeLookOutLeft'] = effectiveWeights['eyeLookOutLeft'] ?? mag;
          effectiveWeights['eyeLookInRight'] = effectiveWeights['eyeLookInRight'] ?? mag;
        }

        // Vertical gaze
        if (clampedPitch > 0) {
          const mag = clampedPitch / maxPitch;
          effectiveWeights['eyeLookUpLeft'] = effectiveWeights['eyeLookUpLeft'] ?? mag;
          effectiveWeights['eyeLookUpRight'] = effectiveWeights['eyeLookUpRight'] ?? mag;
        } else if (clampedPitch < 0) {
          const mag = -clampedPitch / maxPitch;
          effectiveWeights['eyeLookDownLeft'] = effectiveWeights['eyeLookDownLeft'] ?? mag;
          effectiveWeights['eyeLookDownRight'] = effectiveWeights['eyeLookDownRight'] ?? mag;
        }
      }

      // 2. Apply to all morph meshes
      for (const mesh of morphMeshes) {
        const influences = mesh.morphTargetInfluences;
        if (!influences) continue;
        const meshMap = targetDictionary.get(mesh);
        if (!meshMap) continue;

        for (const [name, index] of meshMap.entries()) {
          const w = effectiveWeights[name];
          influences[index] = w !== undefined ? Math.max(0, Math.min(1, w)) : 0;
        }
      }

      // 3. Apply eye node rotations if nodes exist
      if (gaze) {
        const clampedYaw = Math.max(-maxYaw, Math.min(maxYaw, gaze.yaw));
        const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, gaze.pitch));
        euler.set(clampedPitch * pitchMult, clampedYaw * yawMult, 0, 'YXZ');
        gazeQuat.setFromEuler(euler);

        if (leftEyeNode && leftEyeRestQuat) {
          leftEyeNode.quaternion.copy(leftEyeRestQuat).multiply(gazeQuat);
        }
        if (rightEyeNode && rightEyeRestQuat) {
          rightEyeNode.quaternion.copy(rightEyeRestQuat).multiply(gazeQuat);
        }
      }
    },

    reset(): void {
      for (const mesh of morphMeshes) {
        if (mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences.fill(0);
        }
      }
      if (leftEyeNode && leftEyeRestQuat) {
        leftEyeNode.quaternion.copy(leftEyeRestQuat);
      }
      if (rightEyeNode && rightEyeRestQuat) {
        rightEyeNode.quaternion.copy(rightEyeRestQuat);
      }
    },

    dispose(): void {
      binding.reset();
    },
  };

  return binding;
}
