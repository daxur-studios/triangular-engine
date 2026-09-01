# Characters

`triangular-engine/characters` provides framework-free humanoid-character
primitives: a canonical humanoid bone vocabulary, a procedural rig, and
(planned) locomotion, look-at, poses, reach, and emotion.

The core intentionally does not own authored animation content, game locomotion
state machines, AI, or rendering. Games drive characters through intents and
expressions; the core turns those into plausible motion.

```ts
import {
  HUMAN_BONE_NAMES,
  createHumanoidRig,
} from 'triangular-engine/characters';

const rig = createHumanoidRig();
const head = rig.boneByName.get(HUMAN_BONE_NAMES.head)!;
```

See the demo app's `/characters-lab` route for the bones-only slice and
`docs/runbook/027_characters_sublibrary.md` for the implementation plan.
