# Characters

`triangular-engine/characters` provides framework-free humanoid-character
primitives: a canonical humanoid bone vocabulary, a procedural rig, forward
kinematics, locomotion, look-at, poses, and two-bone reach IK. Emotion is
planned.

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

See the demo app's `/characters-lab` route for the bones-only slice and
`docs/runbook/027_characters_sublibrary.md` for the implementation plan.
