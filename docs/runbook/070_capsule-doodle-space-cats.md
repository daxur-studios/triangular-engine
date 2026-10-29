---
type: Runbook
title: "Capsule Doodle Space Cats"
description: "Dated decisions, findings and evidence for Capsule Doodle Space Cats."
timestamp: 2026-10-28T00:00:00Z
tags: [engineering-records]
record_id: er-070
scope_history_schema: 1
plans:
  - /docs/plans/070_capsule-doodle-space-cats.md
performance: []
---

# Engineering Record 070: Capsule Doodle Space Cats

Plan: [PLAN-070](/docs/plans/070_capsule-doodle-space-cats.md).

## 2026-10-28 — Starting

**Goal.** Add a four-legged Capsule Doodle Space Cat system that reuses the humanoid Capsule
Doodle contracts and adds the cat-specific body patterns, face, quadruped gaits, tail, paws and
gear. The reference sheet's dogs stay out of scope.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/070_capsule-doodle-space-cats.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

### 2026-10-28 — Implementation

- **Framework-free core.** Added `capsule-cat-dna.ts` (three body patterns, four gaits, seven
  presets), `capsule-cat-locomotion.ts` (diagonal four-beat trot, galloping bound, zero-G float,
  breathing idle, four rubber-hose legs, S-curved tail) and `capsule-cat-face-projection.ts`
  (`:3` / `MEOW` mouth uniforms, eye/eyelid poses, ear perk, whisker spread).
- **Three.js assembly.** Added `capsule-cat-body-material.ts` (horizontal capsule, shader
  suit/fur split, omega mouth), `capsule-cat-face-rig.ts` (ears, tuft, googly eyes, nose,
  whiskers), `capsule-cat-tail.ts` (zero-allocation tapered cubic Bezier tube),
  `capsule-cat-paws.ts` (fur or bootie paws), `capsule-cat-space-gear.ts` (angled helmet,
  dorsal pet jetpack + harness, mini saddle packs) and `capsule-cat-actor.ts`.
- **Demo.** Added the **Capsule Space Cats** mode to `/characters-lab` with a hero customizer
  (preset, gait, pattern, pack, toggles, fur palette, proportions) and a seven-cat lineup.
- **Tuning.** The leg solver length is decoupled from the resting leg drop so a bounding cat
  can extend its hind legs without the IK target being clamped.
- **Positioning.** Ears, tuft, whiskers and nose were moved onto the front dome surface, and the
  shader mouth is limited to front-facing normals so the omega mouth does not wrap around the
  head.

### 2026-10-28 — Verification

- `npx tsc --noEmit -p projects/triangular-engine/tsconfig.spec.json` — no type errors.
- `npx tsc --noEmit -p projects/demo-app/tsconfig.app.json` — no type errors.
- `npm run test:triangular-engine:characters` — 132 specs pass.
- `npm run test:triangular-engine:procedural` — 260 specs pass.
- `npm run build:triangular-engine` — package builds (including the new exports).
- `npx ng build demo-app` — Angular template compilation completed; the bundle step stops on
  the unrelated missing `mermaid` package imported by `@daxur-studios/mermaid-runtime`.
  No cat/character template error was reported before that bundling failure.

### 2026-10-29 — Locomotion Stride, Emotion Kinematics & Test Runner Integration

- **Locomotion Stride Direction Fix.** Inverted the $Z$ stride kinematics in `capsule-locomotion.ts`
  and `capsule-cat-locomotion.ts` so airborne limbs swing forward ($+Z$) and grounded contact limbs
  push backward ($-Z$) across both humanoids and quadrupeds.
- **Feline Facial Emotion Kinematics.**
  - Added 3D ear rotation (`CapsuleCatEarPose` with pitch, yaw, and roll per ear) in `capsule-cat-face-projection.ts`
    and applied it in `CapsuleCatFaceRig` to support feline cartoon expressions (airplane ears for angry,
    pinned-back for fearful, drooping for sad, perky upright for happy/surprised, and asymmetric one-ear twitch for skeptical).
  - Added cartoon vampire fangs (`uFangsVisible`) and asymmetric smirk tilt (`uMouthAsymmetry`)
    to the procedural body SDF mouth shader in `capsule-cat-body-material.ts`.
  - Modulated whisker pitch/spread per emotion (bristled forward on angry, drooping down on sad).
  - Modulated tail kinematics in `capsule-cat-locomotion.ts` based on current emotion (aggressive whipping
    lash on angry, puffed-up bottle-brush tail tucked low on fearful, limp droop on sad, upright hook on happy).
- **`triangular-engine/testing` Integration in `/characters-lab`.**
  - Integrated `<tri-test-runner>` with collapsible details, test status indicators, and control locking.
  - Implemented `CharactersLabTestAdapter` and test suites (`cat-emotions`, `cat-lineup`, `cat-speech`, `human-baselines`)
    in `characters-lab-tests.ts` supporting headless automated verification and URL parameter auto-start
    (`?testSuite=cat-emotions&testVersion=1&testAutoStart=1`).
- **Verification.**
  - `npm run test:triangular-engine:characters` — 138 specs pass.
  - `npm run test:triangular-engine:procedural` — 264 specs pass.
  - `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include projects/demo-app/src/app/pages/characters-lab/**/*.spec.ts` — 5 specs pass.
  - Automated runner run: `npm run test:summary '--' --suite cat-emotions` verifies all 8 scenarios pass (`auto=pass`).

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
