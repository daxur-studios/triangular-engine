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
performance:
  - id: cat-emotions-v1
    url: http://triangular-demo.localhost:4200/characters-lab?testSuite=cat-emotions&testVersion=1&testProfile=human-observed&testMode=quick&testRepetitions=1&testAutoStart=1
    status: runnable-functional
    evidence:
      - artifacts/test-runs/cat-emotions@v1/2026-10-29T13-46-59-264Z_headless-hardware_quick_0d50724c-c716e3f0.json
      - artifacts/test-runs/cat-emotions@v1/2026-10-29T13-50-36-151Z_headless-hardware_quick_0d50724c-25e23b60.json
  - id: cat-lineup-v1
    url: http://triangular-demo.localhost:4200/characters-lab?testSuite=cat-lineup&testVersion=1&testProfile=human-observed&testMode=quick&testRepetitions=1&testAutoStart=1
    status: runnable-functional
    evidence:
      - artifacts/test-runs/cat-lineup@v1/2026-10-29T13-47-33-761Z_headless-hardware_quick_0d50724c-c716e3f0.json
      - artifacts/test-runs/cat-lineup@v1/2026-10-29T13-52-37-372Z_headless-hardware_quick_0d50724c-26ae6a75.json
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

### 2026-10-29 — Reference review and locomotion attachment correction

- The new cat design sheet depicts a separate round head, a cylindrical body, short
  legs and an upright hooked tail. The existing single capsule merges head and torso;
  a silhouette redesign remains open and needs visual review from multiple angles.
- Corrected the socket transform to match the actor's XYZ Euler rotation and applied
  the fearful body drop to the sockets as well as the torso. Added a regression check.
- The configured demo hostname did not resolve, so the current hero and lineup could
  not be reviewed and the browser suites could not be rerun. The earlier passing
  `cat-emotions@v1` result is stale and its visual review remains pending; no saved
  `cat-lineup` result was found. No visual acceptance is implied.
- The per-frame path currently allocates locomotion samples, vectors, face projections
  and spring state; the handover's zero-allocation assertion is not established.

### 2026-10-29 — Demo access correction

- The earlier availability conclusion was incorrect: Chromium opens the documented
  hostname even though PowerShell DNS resolution fails. The hero and seven-cat lineup
  render in the browser. The new reference calls for a more distinct spherical head;
  the visual redesign and detailed motion review remain open.
- Fresh quick, noisy, headless `cat-emotions@v1` and `cat-lineup@v1` runs both
  completed with automated verdict `pass`; visual review remains pending. These are
  functional checks, not performance or visual acceptance.

### 2026-10-29 — First head and expression refinement

- Widened the front dome with a smooth transition into the existing capsule; moved
  face attachments to the new surface. No separate head mesh or new public DNA was added.
- Closed negative expressions now use a downturned line. Removed the extra smile
  over open mouths and adjusted the opening curvature; disgust has asymmetric narrowed lids.
- The character suite passed 140 specs, the procedural suite passed 265 specs, and the
  library build and records check passed. Quick noisy headless emotion, lineup and speech
  suites passed automated checks. They do not establish appearance or gait quality.
- Browser review confirmed the sad frown and removal of the doubled angry outline; the
  final angry curvature, disgust, speech, head from multiple angles, all variants and gait
  still require a detailed visual pass. Human visual review remains pending.
- A later disgust adjustment removed faint fangs from its nearly closed mouth; the updated
  character suite, demo adapter tests, library build and emotion browser run passed. The
  saved lineup and speech runs predate that small expression change.
- The first profile review showed the head enlargement was too subtle. Increased the
  smooth front widening and resized the helmet and collar. Procedural tests, the build,
  and a fresh lineup functional run passed. Visual fit and final expression review remain open.

### 2026-10-29 — Helmet neck fit

- Moved the helmet collar behind the ears to a centered, untilted capsule cross-section;
  its radius follows the widened body there. Matched the bubble's open rim to the
  collar and gave the dome room around the ears. Applied the same neck position
  and radius to standalone collars.
- The procedural suite passed 266 specs, including a collar and dome alignment
  check, and the library build passed. The demo showed the collar seated on the
  neck in a side view; its close-up clipped the top of the head, so ear clearance
  still needs visual confirmation across views, poses and presets.
## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->

### 2026-10-29 — Head proportion and initial rendering check

- Reduced front-dome widening from 23% to 17%; the existing expression rig and
  smooth transition remain in place. Helmet sizing was retained for clearance.
- A short exploratory headless Chrome run on the NVIDIA GeForce RTX 3080 Laptop
  GPU counted WebGL draw commands over five seconds: about 207 per browser
  animation frame for the default single-cat scene, and 1,651 for the seven-cat
  lineup. These are whole-scene counts, including any shadow and other passes,
  not isolated per-cat counts. Canvas sizes were 1440×315 and 1440×491. Observed
  animation callback rates were approximately 150 and 64 per second respectively;
  this instrumented, headless run is not a production performance benchmark.
- Many small facial, paw and equipment meshes cast shadows; investigate their
  individual contribution and batching or selective shadow casting before
  choosing optimizations. Measure with representative scenes and target devices.
- The procedural suite passed 265 specs and the library build passed. Visual
  confirmation of the adjusted head and helmet fit is still needed.

2026-10-29: Added a small rear cross below the tail in the existing body shader; it introduces no additional mesh or draw call. Procedural suite passed (266). The demo returned missing resources during the visual check, so rear-view placement and shader rendering still need visual confirmation when it is available.

2026-10-29: Raised jetpack and mini packs to sit on the widened back, preserving a small seating overlap. Placement checks cover presets and all pack variants; procedural suite passed (268) and library build passed. Visual review in the demo remains open.
