# Characters

`triangular-engine/characters` provides framework-free humanoid-character
primitives: a canonical humanoid bone vocabulary, a procedural rig, forward
kinematics, locomotion, look-at, and poses. Reach and emotion are planned.

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
```

### Three.js binding

`triangular-engine/characters/three` draws a rig as joint spheres and bone
cylinders, keeping the Three.js dependency out of the core entry point:

```ts
import { createHumanoidRig } from 'triangular-engine/characters';
import { HumanoidRigVisualization } from 'triangular-engine/characters/three';

const view = new HumanoidRigVisualization(createHumanoidRig());
scene.add(view.group);
view.setPose(sampleLocomotion('run', 2).pose);
```

See the demo app's `/characters-lab` route for the bones-only slice and
`docs/runbook/027_characters_sublibrary.md` for the implementation plan.
