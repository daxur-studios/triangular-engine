# Characters

`triangular-engine/characters` provides framework-free humanoid-character
primitives: a canonical humanoid bone vocabulary, a procedural rig, forward
kinematics, locomotion, look-at, poses, two-bone reach IK, and facial emotion
(ARKit blendshapes) plus speech visemes.

The core intentionally does not own authored animation content, game locomotion
state machines, AI, or rendering. Games drive characters through intents and
expressions; the core turns those into plausible motion.

```ts
import {
  HUMAN_BONE_NAMES,
  blendPoses,
  createHumanoidRig,
  sampleLocomotion,
  sampleLookAtPose,
  solveForwardKinematics,
  solveTwoBoneIk,
  SIT_POSE,
} from 'triangular-engine/characters';

const rig = createHumanoidRig();
const head = rig.boneByName.get(HUMAN_BONE_NAMES.head)!;

// Resolve a pose into world-space joint positions.
const solved = solveForwardKinematics(rig, sampleLocomotion('walk', 1.5).pose);

// Blend a seated pose over a named intent.
const sit = blendPoses({}, SIT_POSE, 0.6);

// Aim the head at a world point.
const looking = sampleLookAtPose({ x: 0, y: head.restPosition.y, z: 0 }, { x: 2, y: 1.5, z: 1 });

// Reach the right hand toward a world point with two-bone IK.
const reach = solveTwoBoneIk(
  rig,
  {},
  HUMAN_BONE_NAMES.rightUpperArm,
  HUMAN_BONE_NAMES.rightLowerArm,
  HUMAN_BONE_NAMES.rightHand,
  { x: 0.4, y: 1.1, z: 0.3 },
).pose;
```

### Three.js binding

`triangular-engine/characters/three` builds a real `THREE.Bone` tree from a
rig, wrapped with a `THREE.Skeleton`, and renders it with `THREE.SkeletonHelper`
lines plus small joint markers. Poses are applied as local bone quaternions, so
the same tree can later host a `SkinnedMesh` or drive `AnimationMixer` clips:

```ts
import { createHumanoidRig } from 'triangular-engine/characters';
import { HumanoidRigVisualization } from 'triangular-engine/characters/three';

const view = new HumanoidRigVisualization(createHumanoidRig());
scene.add(view.group);
view.setPose(sampleLocomotion('run', 2).pose);

// Exposed for skinned-mesh / authored-clip integration later.
const { bones, skeleton } = view;
```

`applyPoseToSkeleton` retargets a `RigPose` onto any `THREE.Skeleton` whose bones
use the canonical VRM/Mixamo names, so a GLB/glTF character can be driven by the
same motion (with an optional bone-name mapper for non-standard rigs):

```ts
import { applyPoseToSkeleton } from 'triangular-engine/characters/three';
applyPoseToSkeleton(pose, gltfSkeleton);
```

### Facial emotion and speech

The core emits ARKit blendshape weights (`0..1`) and a deterministic
text → timed-viseme track, so a head with morph targets can smile or talk without
a TTS-specific viseme source:

```ts
import {
  sampleEmotion,
  visemeToBlendShapes,
  wordsToVisemes,
  sampleVisemeTrack,
} from 'triangular-engine/characters';

const emotion = sampleEmotion('happy', 0.8);          // ARKit weight map
const track = wordsToVisemes(['hello', 'there']);     // timed viseme keyframes
const speaking = visemeToBlendShapes(sampleVisemeTrack(track, 0.3));
```

See the demo app's `/characters-lab` route for the bones-only slice and
`docs/runbook/027_characters_sublibrary.md` for the implementation plan.

## Facial animation


The `triangular-engine/characters` sub-library provides framework-free semantic facial animation controls and a layered composition engine (`FacialAnimationController`). The controls are decoupled from mesh geometry, allowing 3D procedural faces, skinned meshes, and 2D styles to share identical semantic commands.

## Architecture

```text
Semantic Commands (AI Agent / Game Script)
  │
  ├── lookAt(target)
  ├── setExpression("happy", intensity, transition)
  ├── setFaceChannel("brow.right.raise", value, transition)
  ├── blink("left" | "right" | "both", duration)
  └── playVisemes(sequence)
  │
  ▼
FacialAnimationController (Framework-free Core)
  │
  ├── Layer 1: Base Expression (smooth transition between emotion presets)
  ├── Layer 2: Semantic Channel Overrides (independent brow, squint, etc.)
  ├── Layer 3: Procedural / Triggered Blinks (attack/hold/release envelope)
  ├── Layer 4: Speech Visemes (articulatory mouth shapes + rest return)
  └── Layer 5: Eye Gaze Solver (physiological clamp: yaw ±30°, pitch ±20°)
  │
  ▼
FacialFrameState (Per-frame evaluated state)
  ├── channels: Record<FaceSemanticChannelName, number>  [0, 1]
  ├── blendShapes: BlendShapeWeights (ARKit 52)          [0, 1]
  └── gaze: { left: LookAtAngles, right: LookAtAngles }  (radians)
  │
  ▼
Presentation Adapter
  ├── Universal Three.js Binding (bindCharacterFace in triangular-engine/characters/three)
  ├── Reference Face Mesh (buildReferenceFaceMesh in triangular-engine/procedural)
  └── SkinnedMesh / Vector Face Canvas (applyCharacterFacePose)
```

## Conventions

- **Time units**: Seconds (`transitionSeconds`, `durationSeconds`).
- **Channel values**: Normalized `0.0` to `1.0`.
- **Coordinate & Angle conventions**:
  - Radians for all angles.
  - Head forward is `+Z`, up is `+Y`, right is `+X`.
  - Yaw: positive turns left (+Y axis rotation), negative turns right.
  - Pitch: positive pitches down (+X axis rotation), negative pitches up.
  - Gaze limits: Yaw clamped to `±0.52` rad (±30°), Pitch clamped to `−0.35` rad (up 20°) / `+0.35` rad (down 20°).

## Supported Capabilities

| Capability | Semantic Channels | ARKit 52 Mapping |
| --- | --- | --- |
| **Eyebrows** | `brow.left.raise`, `brow.right.raise`, `brow.left.lower`, `brow.right.lower` | `browOuterUpLeft`, `browOuterUpRight`, `browInnerUp`, `browDownLeft`, `browDownRight` |
| **Eyelids** | `eye.blink.left`, `eye.blink.right`, `eye.squint`, `eye.wide` | `eyeBlinkLeft`, `eyeBlinkRight`, `eyeSquintLeft/Right`, `eyeWideLeft/Right` |
| **Mouth Expressions** | `mouth.smile`, `mouth.frown`, `mouth.widen` | `mouthSmileLeft/Right`, `mouthFrownLeft/Right`, `mouthStretchLeft/Right` |
| **Mouth Speech** | `mouth.jawOpen`, `mouth.lipClose`, `mouth.round`, `mouth.funnel` | `jawOpen`, `mouthClose`, `mouthPucker`, `mouthFunnel` |
| **Cheeks** | `cheek.puff`, `cheek.squint.left`, `cheek.squint.right` | `cheekPuff`, `cheekSquintLeft`, `cheekSquintRight` |

### Independent Eyebrow Control
The right eyebrow can be raised alone while the left stays neutral or lowered (for skeptical or inquisitive looks):
```ts
controller.setFaceChannel('brow.right.raise', 0.9, 0.15);
controller.setFaceChannel('brow.left.lower', 0.25, 0.15);
```

### Layered Control Combination
Overlapping controls combine without overwriting each other:
1. **Expression + Speech**: If the character is smiling (`mouth.smile` = 0.7) and speaks an open vowel `A` (`mouth.jawOpen` = 0.6), the smile corners remain pulled up into the cheeks while the jaw opens cleanly.
2. **Speech Lip Closure**: For bilabial sounds (`M`, `B`, `P`), `mouth.lipClose` activates and seals the lips together at the horizontal seam, even if the character is smiling.
3. **Blinking + Squint**: Procedural blinks modulate the eyelid position using `Math.max(expressionBlink, blinkEnvelope)`, preventing sudden pops.
4. **Speech Completion**: When a speech viseme track finishes, articulators decay smoothly back to zero, returning the mouth cleanly to the expression baseline.

## Three.js Presentation Binding (`bindCharacterFace`)

The `triangular-engine/characters/three` secondary entry point provides `bindCharacterFace`:

```ts
import { bindCharacterFace } from 'triangular-engine/characters/three';

const faceBinding = bindCharacterFace(gltfModel, {
  driveEyeMorphsFromGaze: true,
});

// In animation loop:
faceBinding.applyPose(frameState.blendShapes, frameState.gaze.left);
```

### Supported Morph Target Standards
`bindCharacterFace` inspects child meshes and automatically normalizes diverse naming conventions to canonical ARKit 52:
- **Canonical ARKit**: `eyeBlinkLeft`, `mouthSmileRight`, `jawOpen`
- **Suffix variants**: `eyeBlink_L`, `eyeBlink_R`, `mouthSmile_l`, `browDown.R` (used by Three.js `facecap.glb` and Blender)
- **Prefixed identifiers**: `blendShape1.eyeBlink_L`, `BS_jawOpen`, `head.mouthSmile_R`
- **Oculus / VRM conventions**: `Eye_Blink_L`, `Mouth_Smile_R`, `Jaw_Open`

### Eye Gaze Orientation
When eye pivot nodes are present (e.g. `grp_eyeLeft`, `grp_eyeRight`, `eyeLeft`, `eyeRight`), `bindCharacterFace` rotates them relative to their rest quaternion. When standard ARKit eye morphs exist (`eyeLookInLeft`, `eyeLookOutRight`, `eyeLookUpLeft`, `eyeLookDownLeft`), it drives their weights from horizontal and vertical gaze angles.

## Proving Ground Demo

Open `/characters-lab` in the demo application:
- **Face Model Toggle**: Switch between the authored **FaceCap ARKit 52 Reference Model** and the **Procedural Head** to compare deformation fidelity side-by-side.
- **Face Studio Mode**: Close-up portrait camera with front, 3/4, and profile view angles, and three-point portrait lighting.
- **Interactive Gaze Reticle**: Directs eye pupils within anatomical limits.
- **Individual Channel Sliders**: Test fine controls for brows, eyelids, and mouth.
- **Articulation Fixture**: Play a deterministic sequence demonstrating `M` (closed), `A` (open), `O` (round), and `E` (wide).
- **Combined Performance**: Test smiling while speaking, looking around, and blinking simultaneously.
- **Reset**: Smoothly returns to neutral.

## Capsule Doodle / Rubber-Hose Procedural Rig

`triangular-engine/characters` also provides framework-free DNA, 3-point Quadratic Bezier limb IK, gait cycles, spring-damper secondary motion, and 2D SDF mouth / googly-eye projection for pill-shaped "Capsule Doodle" space characters:

- `CapsuleCharacterDNA`, `CAPSULE_CHARACTER_PRESETS`, `normalizeCapsuleCharacterDNA`, `generateCapsuleCharacterDNA`
- `solveRubberHoseLimb`, `evaluateQuadraticBezierPoint`, `evaluateQuadraticBezierTangent`, `sampleCapsuleLocomotion`, `stepSpringDamper3D`
- `projectCapsuleFaceState` (maps `FacialFrameState` semantic channels, ARKit weights, visemes, and gaze into 2D SDF mouth shader uniforms and googly-eye/hemisphere-eyelid/floating-brow transforms)

The corresponding Three.js procedural assembly (`CapsuleCharacterActor`, `buildCapsuleBodyMesh`, `buildCapsuleFaceRig`, `RubberHoseLimbMesh`, `buildCapsuleHairKit`, `buildCapsuleSpaceGear`) lives in `triangular-engine/procedural`.
