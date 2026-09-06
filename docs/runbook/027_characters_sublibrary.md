# 027 — Characters sub-library

## Status

- State: **Reoriented after the first implementation pass.** The mechanical
  foundations and several procedural body experiments exist, but the current
  result is not yet a satisfactory game character. The next milestone is a
  single, coherent reference character that can complete a small interaction
  loop and can be driven through the same API by game code or a local AI agent.
- Entry point: `triangular-engine/characters` (core) and
  `triangular-engine/characters/three` (Three.js binding).
- Proving ground: `/characters-lab`, currently an integration demo with a
  procedural body, rig, gait, sit, look-at, reach, emotion, speech, and an
  optional Mixamo clip picker. It is an integration testbed, not yet the
  reference-character quality bar.
- Reference repos examined (cloned to `D:\external\`, not vendored):
  [TalkingHead](https://github.com/met4citizen/TalkingHead) and
  [vrm-game-starter](https://github.com/norio/vrm-game-starter).
- Last updated: 2026-09-06.

## Objective

Build reusable, extendable humanoid-character primitives for **simple,
abstract, functional** characters that games and local AI agents can direct.
The first quality target is one complete reference character: it must walk,
look, sit, speak with readable expression, reach for a supported object, grip
it, carry it, and release it. Variation and additional visual styles follow
only after that loop works.

The architectural target is:

> A tested character capability layer with replaceable presentation, and a
> replaceable brain that only ever talks in validated intents.

The API must support a progression from high-level scene actions to precise
performance controls, such as `walkTo`, `sitOn`, `lookAt`, `reachTo`, `grasp`,
`speak`, `setExpression`, and bounded channels such as
`brow.right.raise`. Raw per-bone control is an advanced escape hatch.

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
- an intent/action layer shared by games, scripted scenes, and AI agents;
- capability discovery, action handles, cancellation, completion events, and
  structured failure reasons;
- interaction targets and affordances for supported props (sit points, hand
  grips, carry/release anchors);
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

The AI boundary is narrower than a general autonomous-agent framework. A local
model proposes structured scene commands; the engine owns pathing, timing,
blending, IK, collision checks, and capability validation. Commands are
observable and interruptible so an agent can react to completion or failure.

## Core decisions

### 1. Rebuild the proving ground around one reference character

Keep `/character-lab` as a historical comparison sandbox and `/characters-lab`
as the integration proving ground, but stop treating the existing style
catalogue as the quality target. Create one deliberately art-directed,
procedural reference character with close-up inspection and a scripted
interaction loop. Retain the rig, FK, gait, look-at, pose, IK, emotion,
viseme, and retargeting utilities provisionally; replace presentation code
when it prevents the reference character from looking and behaving well.

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

### 6. Actions are semantic, layered, and observable

Expose semantic channels and actions instead of asking an agent to author
continuous joint rotations. High-level actions compose with performance
controls; overlapping controls have explicit ownership and smooth release.
Every action has duration and interruption rules and returns a handle with
running, completed, cancelled, or failed state plus a machine-readable reason.
A character reports the expressions, grips, and motion capabilities it
actually supports.

### 7. Build faces, hands, clothes, and hair as focused systems

Faces and hands are quality-critical subsystems, not incidental geometry in a
generic body builder. Start with a small supported set of face controls,
hand/palm orientations, grip poses, hairstyles, and clothing constructions.
Seeded variation may combine only validated parts. Add a second visual style
after the reference character proves that shared intents can drive different
presentations.

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

### Phase 0 — Foundation audit and reference-character slice

- [x] Add the `triangular-engine/characters` secondary entry point.
- [x] Define the canonical humanoid bone names/hierarchy.
- [x] Build a procedural `HumanoidRig` (no mesh; bones drawn as lines/joints).
- [x] Implement analytic walk/run gait, idle, look-at, and sit pose.
- [x] Implement reach IK (two-bone arm/hand).
- [ ] Implement the emotion vocabulary + a small mood table (posture/head only).
- [x] Add `/characters-lab` demo route: bones view + controls for look target,
      walk/run, sit.
- [ ] Record which contracts were genuinely required.

Exit gate: one reference character completes a scripted walk → look → sit →
speak → reach → grasp → carry → release sequence, with visible quality review
and the same sequence executable through structured commands.

### Phase 1 — Extraction + authored swap-in

- [ ] Extract the demo spike onto `core` without changing its feel.
- [ ] Rest-pose retargeting helper for authored clips.
- [ ] Optional `three/` instanced/visual presentation helpers.

### Phase 2 — Face + speech (only when a mesh exists)

- [ ] Apply mood tables to a blendshape face (VRM or GLB).
- [ ] Minimal English viseme mapper + TTS/audio-driven timing behind the
      viseme interface.
- [ ] Cue queue for scheduled gestures/expressions mid-speech.

### Phase 3 — Agent control and scene composition

- [ ] Define versioned semantic command schemas and capability reporting.
- [ ] Add action handles, cancellation, completion events, and failure codes.
- [ ] Add prop affordances: sit points, reach targets, grip poses, and release
      anchors.
- [ ] Execute a deterministic scripted scene through the command API.
- [ ] Add a local-model adapter that validates model output before execution;
      keep the model optional and outside the core package.
- [ ] Support bounded fine control for expression channels, gaze, hand targets,
      timed poses, and custom trajectories.

## Non-goals

- A universal human species class or realistic human model.
- Realistic photo avatars (Ready Player Me / Avaturn).
- A mandatory behaviour-tree/GOAP/utility-AI framework.
- TalkingHead's dynamic bones or geometry-mutating Mixamo retargeter.
- Making every character a physics rigid body or Angular component.
- Claiming the bones POC proves convincing close-up humans.
- Letting a local model write arbitrary per-frame joint rotations as the normal
  control path.
- Adding broad clothing, hair, face, or species combinatorics before the
  reference character and interaction loop are reliable.

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

### 2026-09-02 — Emotion, visemes, and skeleton retargeting

- Added `core/blend-shapes.ts`: the canonical ARKit 52 blendshape names, an
  Oculus/VRM → ARKit translation map, a small emotion vocabulary
  (`neutral`/`happy`/`sad`/`angry`/`surprised`/`fearful`/`disgusted`), and
  `sampleEmotion`/`blendBlendShapeWeights`. Weights are plain `0..1` data, so the
  Three.js layer just writes `morphTargetInfluences`.
- Added `core/visemes.ts`: a 15-viseme articulatory set with `preProcessText`,
  `wordsToVisemes` (grapheme → timed keyframes at a speaking rate), and
  `sampleVisemeTrack`/`visemeToBlendShapes`. Deliberately approximate so lipsync
  works with `speechSynthesis` (which exposes no viseme timestamps); real TTS
  viseme events can feed `visemeToBlendShapes` directly.
- Added `three/pose-to-skeleton.ts`: `applyPoseToSkeleton` retargets a `RigPose`
  onto any `THREE.Skeleton` by canonical bone name (with an optional name mapper),
  bridging the procedural motion to authored GLB/glTF characters.
- Verified: 65 character specs pass. Demo wiring (emotion/speech controls) is
  deferred until the procedural face mesh lands in `triangular-engine/procedural`.

### 2026-09-02 — Procedural body mesh + demo emotion/speech

- The `procedural` side landed `buildCharacterBodyMesh` (skinned humanoid body,
  finger-count LODs, ARKit-compatible face morphs). Added `procedural/characters/
  character-face.ts` (`arkitToCharacterFace`/`applyCharacterFacePose`) to project
  the ARKit weights from `characters` onto the body mesh's seven morph targets.
- Wired `/characters-lab`: the body mesh is skinned to the same `Skeleton` the
  visualization drives, and an emotion `<select>` plus a speech input/Speak button
  drive `morphTargetInfluences` from `sampleEmotion` + text-estimated visemes
  (browser `speechSynthesis` supplies the voice; viseme timing is grapheme-based).
- Verified: 66 character specs + 224 procedural specs pass; library and demo app
  build clean.

### 2026-09-02 — Mixamo clip retargeting + demo file picker

- Added `three/retarget-clip.ts`: `retargetMixamoClip(targetSkeleton,
  sourceSkeleton, clip)` delegates to three's `SkeletonUtils.retargetClip` with a
  canonical→Mixamo `names` table (`MIXAMO_BONE_MAP`) and per-bone `localOffsets`
  that reconcile Mixamo's T-pose with our A-pose. Root motion is dropped (in-place),
  and Mixamo's extra `Spine1`/`Spine2` fold into `chest`.
- Key detail 1 — naming: Mixamo exports are inconsistent. Some name bones
  `mixamorig:Hips` (`FBXLoader` sanitizes the `:` away → `mixamorigHips`), others
  use bare `Hips`. The map stores bare names and `retargetMixamoClip` strips a
  leading `mixamorig` from each source bone before matching, so both resolve.
- Key detail 2 — mirror: Mixamo places `Left*` bones on +X and `Right*` on −X,
  while the canonical rig has `left*` on −X and `right*` on +X (both face +Z).
  Left/right are therefore swapped in `MIXAMO_BONE_MAP`, otherwise retargeted
  motion appears cross-limbed (legs "cross" left/right). Verified against the
  actual FBX rest poses (`mixamorigLeftUpLeg` at +X, `mixamorigRightUpLeg` at −X).
- Added `setOverlayVisible` to `HumanoidRigVisualization` (hide helper lines +
  joint spheres) and a Debug/Bones toggle; fixed the sit pose's knee sign (shins
  now hang down instead of curling forward) and dropped the body to ground feet.
- `/characters-lab` gains a file picker that parses a `.fbx` (FBXLoader), rebuilds
  the source `Skeleton`, retargets the first clip, and drives the procedural body
  via `AnimationMixer`.
- Verified: 71 character specs pass; library + demo app build clean.

### 2026-09-06 — Reorientation toward a complete reference character and AI control

- Reviewed the current `/character-lab`, `/characters-lab`, `characters`, and
  `procedural/characters` work as a whole. The engine has useful rigging,
  motion, IK, expression, viseme, retargeting, and several procedural body
  builders, but the result is a collection of demonstrations rather than a
  coherent character quality bar.
- Chose a staged replacement: preserve the mechanical foundations provisionally
  while rebuilding the presentation around one simple reference character and
  one complete interaction loop. Archive older visual experiments as reference
  rather than expanding their catalogue.
- Added the requirement that game code, scripted scenes, and local AI agents
  use the same semantic intent/action interface. The engine executes and
  validates commands; agents select commands and respond to observable results.
- Identified faces, hands, clothing, and hair as dedicated quality workstreams.
  Procedural variation is deferred until each supported part works reliably in
  the reference character and across its core actions.

### 2026-09-06 — Procedural furniture (chair, door) and character affordances

- Added framework-free `CharacterSitAffordance`, `CharacterReachAffordance`, and
  `CharacterDoorAffordance` to `triangular-engine/characters/core/character-affordance.ts`,
  with runtime validators.
- Added `triangular-engine/procedural/furniture` with art-directed procedural
  builders: `buildProceduralChair` (seat, tapered legs, backrest, sit affordance)
  and `buildProceduralDoor` (frame, hinged panel, doorknob, dynamic knob reach
  affordance tracking door swing).
- Updated `/characters-lab`: replaced empty-air sitting and arbitrary floating
  reach with grounded chair sitting (matching humanoid hip drop to chair seat)
  and real door-knob reaching with two-bone IK as the door swings open.
- Verified: 80 character specs + 237 procedural specs pass; library and demo app
  build clean.
