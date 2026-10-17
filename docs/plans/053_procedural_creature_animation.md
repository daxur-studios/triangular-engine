---
type: Plan
title: Procedural Creature Animation
description: Make procedural creatures and stylized characters move believably without hand keyframing, by generating the skeleton first, deriving the mesh and skin weights from it, driving it with low-dimensional procedural motion (stepping IK, springs, look-at), and measuring motion quality with numbers and filmstrips that agents can act on.
timestamp: 2026-10-17T00:00:00Z
tags: [animation, procedural, creatures, characters, ik, skinning, metaballs, agents, testing]
runbook: /docs/runbook/053_procedural_creature_animation.md
---

# Plan 053: Procedural Creature Animation

Status: **planned** (written 2026-10-17 from code reading only; nothing built or measured). Entry-point names
and budgets are proposals until Phase 0 confirms them.
Evidence: [Runbook 053](/docs/runbook/053_procedural_creature_animation.md).

**Goal:** a creature assembled from procedural parts (metaball bodies, extruded SVG parts, primitive solids) walks,
turns, looks around, wags its tail and opens its jaw believably, with no hand keyframing. An AI agent can make and
check changes to it from numbers and still images, and the maintainer checks it by eye in a lab page. The same
motion layers improve the existing humanoid in `characters`, and asset-based humans (Mixamo/VRM) get a clip
state controller with IK layered on top.

**Builds on:**

- `triangular-engine/characters` (Runbook 027): rig, FK, `solveTwoBoneIk`, look-at, poses, facial controller,
  visemes, Mixamo retargeting, affordances.
- `triangular-engine/procedural/parts` (Runbook 016): the archetype → variant pattern with sockets, joints and
  colliders.
- The scene test adapter and capture work (Runbooks 021, 037, 038) for filmstrip capture.
- Feature #3 of Runbook 041 (skeletal animation controller), delivered here as Phase 6.

## Ground rules

- **Nobody authors joint angles.** Neither the maintainer nor an agent keyframes joints. The controls are a few
  numbers (speed, heading, stride, look target, mood, jaw open), and IK, springs and rules set the joints. Raw
  per-bone control stays an advanced escape hatch.
- **Skeleton first, mesh second.** A procedural creature's mesh is grown from its skeleton, so skin weights come from
  the way it was built. This plan has no auto-rigger for arbitrary meshes.
- **Mesh once, skin every frame.** Metaball or SDF surfaces are built **once, in rest pose**, then animated as a
  `SkinnedMesh`. No per-frame marching cubes.
- **Motion quality is measured.** Every phase gate quotes motion metrics (§Motion metrics) and a filmstrip. "Looks
  fine to the agent" is never a gate on its own.
- **Deterministic.** Motion runs on a fixed step from a seed, so the same `(archetype, seed, inputs, time)` gives the
  same pose. That turns motion-quality thresholds into ordinary headless specs.
- **Framework-free cores.** Core motion code imports no Angular, Three.js or sibling entry points (as in
  `characters/core`). Three.js bindings live in a `three/` layer.
- **Stylized, not realistic.** No realistic humans or faces, and no procedural human modeling (Runbook 027 showed
  the uncanny result). Humans come from stylized assets.
- The engine is public: no consumer app names or paths in code, docs or commit text.

## Goals

| # | Goal |
|---|---|
| G1 | Planted feet: in stance, a foot moves ≤ 1 cm on flat ground and ≤ 2 cm on slopes up to 25°, at walk and trot speeds |
| G2 | Any leg count: 2, 4, 6 and 8 legs walk from the same step planner, with the gait pattern set by data |
| G3 | Alive at rest: idle breathing, look-at, tail/antenna follow-through and jaw/blink hinges, with no authored clips |
| G4 | Procedural bodies deform cleanly: metaball skin bends at joints without tearing or candy-wrapper collapse at ±90° |
| G5 | Rigid parts (extruded SVG, primitives) ride on sockets and never float or sink at any pose |
| G6 | Agent-operable: an agent can change a parameter, run a headless check that prints metrics, and get a filmstrip image for review |
| G7 | Asset-based humans: Mixamo/VRM clips cross-fade through a state controller, with look-at and reach IK layered on top |
| G8 | Budget (CPU, maintainer's machine): ≤ 0.05 ms per 30-bone creature per frame; 50 creatures ≤ 2.5 ms (proposed, measured in Phase 1) |

## What was tried before, and the lesson

| Earlier attempt | Lesson |
|---|---|
| Sine-based humanoid gait (`characters/core/locomotion.ts`, Runbook 027) | Joints swing on a clock, so feet are not planted and slide across the ground. That float is a big part of why it reads as uncanny. Feet must be placed by IK and steps triggered by distance, not by a clock |
| Procedural human bodies and faces (`/character-lab`, `procedural/characters`) | Agents produced uncanny results: wrong folds, faces that deform like squashed rectangles. The authored `facecap.glb` baseline looked right at once. Use authored or stylized assets for humans |
| Facial controller + visemes (Runbook 027) | Semantic channels with layered composition work and are agent-friendly. Keep the same shape (named scalar channels, commands, layers) for body motion |
| Procedural parts with sockets and hinges (Runbook 016) | "Sockets are the product, the mesh is decoration." Creature parts follow the same contract |

## Technique options

| Option | Effort | Agent-operable | Fits procedural creatures | Verdict |
|---|---|---|---|---|
| A. Hand-keyframed clips (Blender) | High per creature, needs an animator | No (visual-over-time work) | No: every body shape needs new clips | **No** |
| B. Authored clips + retargeting (Mixamo/VRM) | Low for humanoids | Partly: pick and blend clips | Humanoids only | **Yes, for humans** (Phase 6) |
| C. Procedural motion: stepping IK, body follow, spring chains, look-at, hinges | Medium, once | Yes: few parameters, measurable | Yes, any body shape | **Main approach** (Phases 1–3) |
| D. Body-shape-independent gestures (Spore's approach) | Medium | Yes once the space exists | Yes | **Later** (Phase 5) |
| E. Physics-driven / learned locomotion (active ragdoll, RL) | Research level | No | In theory | **Out of scope** |
| F. Auto-rigging arbitrary meshes | High, fragile | No | Not needed if skeleton-first | **No**: use Mixamo's auto-rigger for imported humans |

## Architecture

Proposed entry points (confirmed in Phase 0):

| Entry point | Owns |
|---|---|
| `triangular-engine/motion` (core, framework-free) | Skeleton graph, IK chains, step planner, gait patterns, body follow, spring chains, look-at on any chain, hinge channels, motion metrics |
| `triangular-engine/motion/three` | Graph → `THREE.Bone`/`Skeleton`, debug overlay (bones, contacts, step targets, support polygon), filmstrip capture |
| `triangular-engine/procedural/creatures` | Creature archetype and validation, skeleton generation from the archetype, metaball skin mesh + skin weights, socketed rigid parts |
| `triangular-engine/characters` (existing) | Humanoid vocabulary on top of `motion`; clip state controller and additive IK layers (Phase 6) |

`motion` is shared so `characters` (humanoids) and `procedural/creatures` (anything) use one solver stack, the same
reuse split Runbook 024 asks for.

### Skeleton graph

A tree of bones with rest offsets, plus tagged **chains**: `spine`, `neck`, `tail`, `leg`, `arm`, `jaw`, `antenna`.
Each chain has a root, joint limits, an IK solver kind (two-bone analytic, or FABRIK for 3+ bones) and a role-specific
config (for a leg: foot bone, hip socket, rest foot position, gait group). The humanoid rig becomes one preset of the
graph.

### Motion layers (evaluated in order each fixed step)

1. **Locomotion intent:** desired velocity and turn rate, from game code or an agent command (`moveTo`, `setSpeed`,
   `face`).
2. **Step planner:** each leg has a home position under its hip, moved ahead by velocity. A foot stays planted until it
   is further than a threshold from home **and** its gait group may lift (only so many feet lift at once, in a phase
   order set by data: biped alternate, quadruped walk/trot, hexapod tripod, octopod wave). A step is an arc over a
   duration from speed. Ground height and normal come from a raycast callback, so the core stays free of physics.
3. **Body follow:** pelvis height and tilt come from the planted feet (average height, plane fit), plus a spring for
   bob and lag.
4. **Leg IK:** every leg chain reaches its foot target. Knee or hock direction comes from a pole vector in the
   chain config.
5. **Look-at:** head/neck/spine weights toward a target (generalized from `characters/core/look-at.ts`).
6. **Secondary motion:** tails, antennae, ears and loose parts as verlet spring chains with stiffness, damping and
   gravity, pinned at their root.
7. **Channels:** scalar hinges (jaw, blink, wing fold) and named poses, blended with the same layered channel model as
   the facial controller.
8. **Gestures (Phase 5):** short targets defined relative to limb length and body frame, solved by the same IK.

### Creature body

- **Archetype:** a list of parts, each with a kind (`metaball-segment`, `extruded-svg`, `primitive`), the bone or
  socket it attaches to, sizes as seeded ranges, and validation rules (legs reach the ground in rest pose, the
  centre of mass lies inside the support polygon, sockets of matching type).
- **Metaball skin:** blobs placed along bone segments. Their SDF (smooth-min of capsules/ellipsoids) is meshed once
  in rest pose (surface nets or marching cubes, in a worker when large). Each vertex is weighted by distance to its
  nearest 2–4 bone segments with a falloff, normalized, and limited to 4 influences. Joints get a blend radius so
  bends stay smooth. Dual-quaternion skinning is tried if linear skinning collapses at ±90° (G4).
- **Rigid parts:** extruded SVG (`SVGLoader` + `ExtrudeGeometry`, or `sketch` if it lands) and primitives are parented
  to one bone through a socket (weight 1.0). An `embed depth` pushes them into the skin so they never float (G5).

### Motion metrics

Pure functions over a recorded pose track (fixed step, N seconds):

| Metric | Meaning | Gate |
|---|---|---|
| `footSlipCm` | Max distance a foot moves while flagged in stance | G1 |
| `groundPenetrationCm` | Max depth of any foot or body sample below ground | ≤ 0.5 cm |
| `jointLimitViolations` | Count of frames with a joint past its limits | 0 |
| `supportMargin` | Min distance of projected centre of mass inside the support polygon (static gaits) | ≥ 0 |
| `jerk` | Peak change in acceleration of root and feet; flags pops | Threshold set in Phase 1 |
| `stepCadence` | Steps per second per leg, and phase order | Matches gait pattern |
| `selfIntersection` | Approximate overlap of limb capsules | ≤ threshold |

### Filmstrip

One image from a fixed camera: N frames across a cycle, tiled (for example 4×3), with optional ghost trails, foot
contact markers (green while planted, red while sliding) and a strip of per-leg phase bars underneath. A vision model,
or the maintainer, can judge a whole cycle in one image. It is captured through the scene test adapter's `capture`
path where available, otherwise through `ScreenshotService`.

## Phases

Each phase ends with metrics in the runbook and a filmstrip checked by the maintainer in the lab page.

0. **Baseline, lab page and measuring tools.**
   - Confirm the entry-point split in §Architecture (or record a different one).
   - Motion metrics (core, with specs) and a pose-track recorder.
   - `/creature-lab` demo page: stick-figure view, debug overlay, scrub, slow motion (0.1×–1×), pause, step frame,
     parameter sliders, filmstrip export.
   - Record the **existing** sine gait from `characters` and capture its metrics and filmstrip. This tests the tools on
     a known-bad case.
   - **Gate:** the baseline `footSlipCm` is recorded and visibly bad in the filmstrip, and a headless spec prints the
     same numbers.
1. **Skeleton graph + stepping IK.**
   - Skeleton graph with chains, a FABRIK solver next to the existing two-bone solver, the step planner, body follow,
     and gait pattern data.
   - Stick-figure biped and quadruped walk and turn on flat ground and a slope.
   - Measure G8 on 1 and 50 creatures.
   - **Gate:** G1 at walk and trot in specs; filmstrips approved; G8 measured.
2. **Alive at rest.** Spring chains (tail, antennae), look-at on any chain, hinge channels (jaw, blink), idle
   breathing, and a hexapod and octopod from gait data only (G2).
   - **Gate:** G2 and G3 by eye in the lab; tail follow-through visible in the filmstrip; no metric regressions.
3. **Creature body.** Metaball skin from the skeleton with skin weights, then socketed rigid parts (one extruded SVG
   horn or plate, one primitive).
   - Three archetypes: biped, quadruped, hexapod with tail.
   - **Gate:** G4 and G5 at extreme poses (a deformation filmstrip of each joint at its limits); walk metrics unchanged
     with the mesh on.
4. **Archetype assembly.** Seeded random creatures from a parts catalogue, with validation that rejects or repairs
   creatures that cannot stand or walk (legs too short, centre of mass off the support polygon, mismatched
   sockets).
   - **Gate:** 100 seeds generate; every accepted creature passes G1 and the support check in a headless sweep, and
     the sweep prints the rejection reasons.
5. **Gestures.** A small set (`roar`, `eat`, `wave/raise-limb`, `crouch`, `happy-bounce`) as targets relative to limb
   length and body frame, blended over locomotion.
   - **Gate:** each gesture reads correctly on all three archetypes and on 10 random seeds (filmstrips).
6. **Humans from assets.**
   - Clip state controller (Runbook 041 feature #3): states, cross-fades, speed scale, loop/clamp, and in-place
     vs root motion.
   - Additive layers over clips: look-at, reach IK, foot IK on uneven ground.
   - Load one VRM (VRoid Studio export) and one Mixamo character; drive the face with the existing
     `FacialAnimationController`.
   - Optional: a texture-swap stylized face (eye/mouth sprites per expression and viseme) as a cheap, robust
     alternative to blendshapes.
   - Optionally move the `characters` gait onto the step planner.
   - **Gate:** idle → walk → talk-with-emotion → look → reach on both assets, with no foot slide (G1) and no pops at
     cross-fades.
7. **Docs and wiring.** `projects/triangular-engine/docs/motion.md` and `creatures.md`, a section in `ai-agents.md`
   (how an agent runs metrics and filmstrips), `CHANGELOG.md`, `entry-points.md`, token-map registration.

## Tests

- IK: two-bone and FABRIK reach reachable targets within tolerance, clamp unreachable ones, respect joint limits and
  pole vectors.
- Step planner: lift order follows the gait pattern; no more feet lift at once than allowed; a stationary creature
  stops stepping.
- Motion-quality specs: fixed-step runs of N seconds per archetype × gait × terrain (flat, slope) assert G1, ground
  penetration, joint limits and support margin. Deterministic, so thresholds are safe in CI.
- Spring chains: settle to rest under gravity; stable at the fixed step under a large root jerk.
- Skin weights: every vertex has 1–4 normalized influences; rigid-part vertices have exactly one bone at weight 1.0.
- Archetype validation: known-bad archetypes are rejected with the expected reason codes.
- Determinism: the same seed and inputs give identical pose tracks.
- Timing is never a spec: specs run headless. Timings go in the runbook.

## Decisions

| Decision | Status |
|---|---|
| Procedural motion (option C) as the main approach for creatures; authored clips + retargeting (B) for humans; no hand keyframing | Proposed (Runbook 052) |
| Skeleton-first creatures with skin weights derived from construction; no auto-rigger | Proposed |
| Meshes built once in rest pose and skinned; no per-frame remeshing | Proposed |
| New `triangular-engine/motion` core shared by `characters` and `procedural/creatures` | Proposed, confirmed in Phase 0 |
| Motion metrics + filmstrips are required gate evidence | Proposed |
| An animation **viewer/inspector** in the lab, not a keyframe editor | Proposed |
| Stylized assets (VRM, Mixamo, CC0 packs) for humans; no procedural human modeling | Proposed |
| Budget G8 | Proposed, measured in Phase 1 |

## Out of scope for now

Hand keyframing tools, a timeline/keyframe editor, realistic humans or faces, physics-driven or learned locomotion,
auto-rigging arbitrary meshes, cloth and hair simulation, swimming and flight locomotion (later plans can reuse the
same layers), and creature AI or behaviour (the game decides intents; this plan turns them into motion).
