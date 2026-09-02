# 027 — Characters sub-library

## Status

- State: **Phase 0 in progress.** Core rig, forward kinematics, locomotion,
  look-at, poses, reach IK, and the Three.js binding are implemented and
  verified; the emotion vocabulary is still pending. No authored mesh or
  animation data is required.
- Entry point: `triangular-engine/characters` (core) and
  `triangular-engine/characters/three` (Three.js binding).
- Proving ground: a bones-only `/characters-lab` demo page with a procedural
  humanoid rig, walk/run gait, sit pose, and head look-at — no authored assets.
- Reference repos examined (cloned to `D:\external\`, not vendored):
  [TalkingHead](https://github.com/met4citizen/TalkingHead) and
  [vrm-game-starter](https://github.com/norio/vrm-game-starter).
- Last updated: 2026-09-01.

## Objective

Add reusable, extendable humanoid-character primitives to the engine: a rig,
locomotion, looking, poses, reach/interaction, and emotion — aimed at
**simple, abstract, functional** characters that agents can drive, not
hyper-realistic humans.

The architectural target is:

> A strong procedural body with a replaceable presentation, and a replaceable
> brain that only ever talks in intents.

## Feasibility summary (why this is possible with no downloaded data)

| Capability                             | Source                                            | Data needed?          |
| -------------------------------------- | ------------------------------------------------- | --------------------- |
| Skeleton / bone visualization          | procedural `THREE.Bone` hierarchy + lines/spheres | none                  |
| Walking / running                      | analytic sine-based gait generator                | none                  |
| Looking at a target                    | head/neck/spine rotation toward a point           | none                  |
| Poses (sit, idle, hands-on-hips)       | named joint-rotation targets + transitions        | none                  |
| Reach / interact                       | analytic two-bone IK                              | none                  |
| Emotion (posture/head)                 | pose + head deltas                                | none                  |
| Emotion (facial)                       | blendshape channels                               | **needs a face mesh** |
| Authored locomotion (mixamo/VRM clips) | keyframe retargeting                              | optional, swap-in     |

Everything in the Phase 0 POC is procedural. Downloaded data is only required
when a consumer adds a rendered face (for facial emotion) or authored animation
clips (as an alternative locomotion source). The core must be written so those
arrive later without changing the public contracts.

## Why this belongs in the engine

The engine already describes worlds (`terrain`, `scatter`, `water`, `spline`),
inhabitants (`animals`, `life`), and game systems (`navigation`, `procedural`,
physics). It has no neutral **humanoid/agent actor** layer. Without one, every
game rebuilds a rig, a walk cycle, look-at, poses, reach, and expression
channels.

`characters` owns reusable humanoid mechanics and leaves species, game meaning,
and authored content to consumers — the same boundary `life` uses for animals.

## What the reference repos taught us

### TalkingHead — the declarative emotion/gesture model

- Everything is **plain data**, not code: `poseTemplates`, `animMoods`,
  `gestureTemplates`, `animEmojis` (`talkinghead.mjs`).
- A mood is `{ baseline, speech, anims }`: `baseline` is blendshape targets,
  `speech` is rate/pitch/volume deltas, `anims` is a nested selection tree
  keyed by state/bodyform/view with weighted `alt` branches.
- Values are scalar, `[min,max]`, or `[start,end,skew]` ranges, so variation is
  free and agents emit tiny intents.
- Lip-sync is a two-method interface per language: `preProcessText(text)` and
  `wordsToVisemes(text) → {visemes, times, durations}` (`lipsync-fi.mjs` is
  ~150 lines; English is rule-based).
- A cue queue (`speakText`, `speakEmoji`, `speakBreak`, `speakMarker`) lets an
  agent schedule gestures at timed points mid-speech.

### vrm-game-starter — the model-agnostic retargeting contract

- `AnimationContract.ts` maps a small status enum → required clip names and
  validates at load.
- `VrmAnimation.ts` retargets one shared animation library onto any humanoid by
  capturing a rest pose (`A_TPose`) and applying per-frame world-space
  quaternion deltas.
- `FootIK.ts` is self-contained analytic two-bone IK + pelvis lowering + foot
  tilt using only `THREE.Raycaster` against collider meshes — no physics engine.

### What to take vs skip

- **Take**: the declarative mood/pose/gesture model, the cue queue, the tiny
  viseme interface, rest-pose retargeting, analytic IK.
- **Skip**: TalkingHead's geometry-mutating Mixamo `retargeter` and dynamic
  bones; vrm-game-starter's WebGPU render pipeline (we have `postprocessing`,
  `takram`, `water`).

## Locked public contracts

These two contracts are the fixed vocabulary everything else targets. They are
both "named scalar channels", just at different granularities.

### 1. Emotion vocabulary — ARKit 52 + Oculus 15 blend shapes

A blend shape is a named scalar 0–1 that deforms a face mesh. ARKit defines a
standard set of 52 (`mouthSmile`, `browDownLeft`, `jawOpen`, …); Oculus defines
15 mouth shapes for speech. Emotion is a **plain data map**, not code:

```ts
const angry = {
  browDownLeft: 0.6,
  browDownRight: 0.6,
  mouthFrownLeft: 0.7,
  jawForward: 0.3,
};
```

Properties:

- model-independent — any avatar exposing those names works;
- agent-friendly — an agent emits `{ mood: 'happy', intensity: 0.7 }`;
- composable — moods blend/add/invert arithmetically;
- extensible to non-face channels (chest, head tilt, hand open/close).

A bones-only rig has no morph targets, so the contract is a no-op until a face
mesh is attached. That is fine: the vocabulary works now as data, becomes
visible later as a mesh.

### 2. Viseme interface — a tiny pluggable lip-sync contract

A viseme is one of ~15 canonical mouth shapes (`aa`, `E`, `I`, `O`, `U`, `PP`,
`SS`, `TH`, `DD`, `FF`, `kk`, `nn`, `RR`, `CH`, `sil`). The interface is two
methods:

```ts
interface LipsyncProcessor {
  preProcessText(text: string): string;
  wordsToVisemes(text: string): {
    visemes: string[];
    times: number[];
    durations: number[];
  };
}
```

`wordsToVisemes` returns which mouth shape happens at which time, so the face
morphs along that timeline. This decouples "text → mouth shapes over time" from
the TTS engine and from the model. Timings arrive three ways — TTS word
timestamps, a rule/dictionary mapper, or audio-driven detection (no text) —
all behind the same interface. Visemes are literally a subset of the emotion
vocabulary, so one channel system serves both speech and expression.

## Product boundary

`characters` may own:

- humanoid bone hierarchy definition and canonical bone names;
- bone debug/visualization (lines, joints) for the rig;
- procedural locomotion (idle/walk/run gait generator) and pose targets;
- look-at and eye/head targeting;
- analytic reach IK (arms) and foot IK;
- the emotion vocabulary and mood tables;
- the viseme interface and a minimal English mapper;
- a cue/timeline queue for scheduled gestures and expressions;
- rest-pose retargeting helpers for authored clips (later);
- optional Angular hosts (`<humanoidCharacter>` / `<character>`) as a thin
  binding over the framework-free core.

Games or higher-level packages should own:

- authored animation content and species-specific animation graphs;
- game locomotion/combat/interaction state machines and AI;
- inventory, quests, combat, and social meaning;
- save/network authority.

The scope alarm is "`Character` acquired hunger, inventory, combat, faction."
A game decides an intent; `characters` turns it into plausible motion and
expression.

## Core decisions

### 1. POC before package extraction

The first implementation is a `/characters-lab` demo page, not scaffolding.
It shows bones, tests emotion/look/walk/sit, with no complex mesh. The spike
discovers the smallest useful contracts; only then extract into
`triangular-engine/characters`.

### 2. Procedural by default, authored as a swappable source

Locomotion, look, poses, and reach are procedural in Phase 0. The
`Locomotion`/`MotionSource` seam must allow an authored-clip source (retargeted
via the rest-pose contract) to replace the procedural gait later.

### 3. Extendable base classes, not a closed character

Provide base classes consumers extend:

- `HumanoidRig` — bone hierarchy + proportions (override for non-human
  proportions);
- `Character` / `MotionController` — state + `update(dt)`;
- `LocomotionSource` — procedural gait (override with keyframes);
- `LookAtController` — head/neck/spine toward a target;
- `PoseController` — named poses + transitions;
- `ReachController` — two-bone arm/hand IK;
- `ExpressionController` — mood → blendshape channels (no-op on bones-only).

### 4. Canonical humanoid bone names as the neutral contract

Use a standard humanoid bone vocabulary (VRM `VRMHumanBoneName`-style or Mixamo
names) so procedural motion and future keyframe retargeting share one skeleton
language. This is what prevents lock-in to any specific model or animation
format.

### 5. `core` stays framework-free

`characters/core` must not import Angular, Three.js, or sibling entry points by
default. Rig math and gait can be pure data + `update(dt)`; Three.js binding
lives in a `three/` or `engine/` layer, matching the `life` convention.

## Proposed package layout

```text
projects/triangular-engine/characters/
  core/                     # framework-free contracts and math
    humanoid-bones.ts       # canonical bone names + hierarchy
    character-rig.ts        # procedural bone hierarchy + proportions
    locomotion.ts           # analytic gait generator
    look-at.ts
    poses.ts                # named poses + transitions
    reach-ik.ts             # analytic two-bone IK
    emotions.ts             # ARKit/Oculus vocabulary + mood tables
    lipsync.ts              # viseme interface + minimal en mapper
    cue-queue.ts
  three/                    # Three.js binding + bone debug rendering
  engine/                   # optional Angular hosts
  public-api.ts
  ng-package.json
  README.md
```

## Phases

### Phase 0 — Bones-only procedural POC

- [x] Add the `triangular-engine/characters` secondary entry point.
- [x] Define the canonical humanoid bone names/hierarchy.
- [x] Build a procedural `HumanoidRig` (no mesh; bones drawn as lines/joints).
- [x] Implement analytic walk/run gait, idle, look-at, and sit pose.
- [x] Implement reach IK (two-bone arm/hand).
- [ ] Implement the emotion vocabulary + a small mood table (posture/head only).
- [x] Add `/characters-lab` demo route: bones view + controls for look target,
      walk/run, sit.
- [ ] Record which contracts were genuinely required.

Exit gate: the page visibly shows bones; an operator (or agent) can drive mood,
look, and locomotion from simple intents without any downloaded assets.

### Phase 1 — Extraction + authored swap-in

- [ ] Extract the demo spike onto `core` without changing its feel.
- [ ] Rest-pose retargeting helper for authored clips.
- [ ] Optional `three/` instanced/visual presentation helpers.

### Phase 2 — Face + speech (only when a mesh exists)

- [ ] Apply mood tables to a blendshape face (VRM or GLB).
- [ ] Minimal English viseme mapper + TTS/audio-driven timing behind the
      viseme interface.
- [ ] Cue queue for scheduled gestures/expressions mid-speech.

## Non-goals

- A universal human species class or realistic human model.
- Realistic photo avatars (Ready Player Me / Avaturn).
- A mandatory behaviour-tree/GOAP/utility-AI framework.
- TalkingHead's dynamic bones or geometry-mutating Mixamo retargeter.
- Making every character a physics rigid body or Angular component.
- Claiming the bones POC proves convincing close-up humans.

## Risks

- **Fun spike becomes architecture work.** Keep Phase 0 demo-local.
- **God-character scope creep.** Reject game state from `Character`; use
  intents and expressions instead.
- **Lock-in to a model/format.** Mitigated by canonical bone names + the two
  locked channel contracts.
- **Visual quality mistaken for AI quality.** Bones are an abstraction proof,
  not a character-quality proof.

## Verification

For each phase, run the narrowest character tests before the library build:

```powershell
npx ng test triangular-engine --watch=false --browsers=ChromeHeadless --include='../characters/**/*.spec.ts'
npm run build:triangular-engine
npx ng build demo-app --configuration development
```

Also confirm:

- `characters/core` has no Angular, Three.js, or sibling-entry-point imports;
- the demo is checked visually at `/characters-lab`;
- unrelated working-tree changes remain untouched.

## Decision log

### 2026-09-01 — Exploration and proposal

- Cloned [TalkingHead](https://github.com/met4citizen/TalkingHead) and
  [vrm-game-starter](https://github.com/norio/vrm-game-starter)
  and reviewed their approaches for humanoid characters,
  speech/emotion, and movement.
- Targeted **simple/abstract/functional** characters that agents can handle,
  explicitly not hyper-realistic humans.
- Confirmed full procedural feasibility: bones, locomotion, look-at, poses, and
  reach require no downloaded data; facial emotion needs a blendshape mesh, and
  authored clips are an optional swap-in.
- Chose `triangular-engine/characters` as the entry-point name.
- Locked two public contracts: (1) the emotion vocabulary as ARKit 52 + Oculus
  15 blend-shape channels; (2) the viseme interface as
  `preProcessText` + `wordsToVisemes`.
- Identified the reusable parts of each repo: TalkingHead's declarative
  mood/pose/gesture data model, cue queue, and tiny viseme interface;
  vrm-game-starter's rest-pose retargeting contract and analytic IK.
- Decided to trace the work in this runbook before writing any code.

### 2026-09-01 — Phase 0 implementation (bones, gait, look, poses)

- Added `triangular-engine/characters` with a framework-free `core/`:
  `character-vector`, `character-quaternion`, `humanoid-bones`,
  `character-rig`, `forward-kinematics`, `poses`, `locomotion`, `look-at`.
- Chose a pure FK model over `THREE.Bone`/`THREE.Skeleton`: each bone stores a
  world-space rest offset from its parent, and `solveForwardKinematics` resolves
  a `RigPose` (per-bone XYZ Euler) into world-space joint positions. This keeps
  `core` free of Three.js and makes motion pure data, unit-testable without a
  renderer.
- Added `triangular-engine/characters/three` as a separate secondary entry
  point holding `HumanoidRigVisualization` (joint spheres + bone cylinders),
  isolating the Three.js dependency from the core entry point.
- Added `/characters-lab`: walk/run gait, sit-pose blend, and head look-at that
  resolves the target in the character's local frame (so yaw/pitch stay correct
  while the character turns).
- Verified: 29 character specs pass and the library + demo app build clean.
- Left for later: reach IK, emotion vocabulary/mood table, and the authored-clip
  rest-pose retargeting seam.

### 2026-09-02 — Reach IK, look-at clamps, line bones

- Added `core/reach-ik.ts` with `solveTwoBoneIk`: analytic two-bone IK over any
  parent→mid→end chain (arms today, legs for foot IK later). It solves the elbow
  in the root→target/pole plane, clamps out-of-range and folded targets, and
  reports `reached`/`elbow`/`end`. Rotations are produced as local XYZ Euler by
  shortest-arc quaternions from each segment's rest direction, then composed
  against the parent's solved orientation.
- Extended `character-vector` (dot/cross/add/subtract/scale) and
  `character-quaternion` (conjugate, `fromUnitVectors`, `toEulerXYZ`) to support
  IK without any framework dependency. `solveForwardKinematics` now also returns
  `orientationByName`.
- Clamped head look-at yaw (±80°) and pitch (−52°/+40°); the demo target now
  swings in a frontal arc ahead of the character and gait freezes while seated.
- Switched `HumanoidRigVisualization` from spheres+cylinders to the conventional
  skeleton look: parent→child `LineSegments` plus small joint dots.
- Added a `Reach` toggle to `/characters-lab` so the right arm points at the
  tracked target with two-bone IK.
- Verified: 43 character specs pass and the library + demo app build clean.

### 2026-09-02 — Real `THREE.Bone` skeleton + look-at overshoot fix

- Reworked `HumanoidRigVisualization` to build an actual `THREE.Bone` tree from
  the rig (local positions = rest offsets), wrapped with a `THREE.Skeleton`
  inversed in the rest pose, and rendered via `THREE.SkeletonHelper` plus small
  joint spheres. Poses are applied as local `THREE.Quaternion`s (intrinsic XYZ
  Euler), so three.js resolves the hierarchy instead of the core FK solver, and
  `view.bones`/`view.skeleton` are exposed for later `SkinnedMesh`/`AnimationMixer`
  use. Added a binding spec asserting the bone tree matches `solveForwardKinematics`.
- Fixed look-at overshoot: the yaw/pitch weights across spine→chest→neck→head
  summed to 2.0 (pitch 1.75), so the accumulated chain doubled the head turn.
  Normalized the weights to sum to 1.0 and added FK-based regression tests.
- Verified: 47 character specs pass and the library + demo app build clean.
