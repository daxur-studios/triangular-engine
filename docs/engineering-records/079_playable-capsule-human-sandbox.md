---
type: EngineeringRecord
title: "Playable Capsule Human Sandbox"
description: "Dated decisions, findings and evidence for Playable Capsule Human Sandbox."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record_id: er-079
scope_history_schema: 1
plans:
  - /docs/plans/079_playable-capsule-human-sandbox.md
performance: []
---

# Engineering Record 079: Playable Capsule Human Sandbox

Plan: [PLAN-079](/docs/plans/079_playable-capsule-human-sandbox.md).

## 2026-11-01 — Starting

**Goal.** Give the procedural capsule human a small playable proving ground: click to move, interact with a rock and chair, then scale to a selectable crowd and measure the real cost.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/079_playable-capsule-human-sandbox.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

## 2026-11-01 — Scope accepted

**Direction.** Keep gameplay use in a new `/capsule-human-sandbox` route, separate from `/character-studio`. Start with one human and a ground-point movement command, then add a visible pickup and sit/stand loop. Build crowd controls and performance/LOD analysis as later phases.

**Boundary.** Reuse the existing `CapsuleCharacterActor` and Plan 074's 1/16/48 diagnostic matrix before adding public engine gameplay APIs. The scene is a local demonstration, not a navigation, physics, or generic interaction framework.

**Open investigations.** The sandbox uses an app-level procedural seated pose because the current actor has no sitting locomotion mode; this avoids a public API change for a single prototype. Its body still overlaps the chair, so refine that pose locally and revisit a reusable actor mode if another consumer needs it. Whole-scene timings still do not attribute cost to individual parts; that remains open before choosing a LOD strategy.

**Checks.** Created the reciprocal Plan 079 / ER 079 pair and recorded the accepted scope. Implementation verification is recorded below.

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-11-01 — Playable scene and first interactions

**Change.** Added `/capsule-human-sandbox`, registered it in the demo index, and created a focused scene with a procedural human, click-to-move ground targeting, selectable 1/16/48 full-actor populations, a pick-up rock, and a chair with sit/stand. The seated pose is an app-level procedural override; no public character API was changed. Renderer draw-call and triangle counts appear as live diagnostics.

**Decision.** Keep the seated pose in the demo app for now. The local pose proves the interaction loop without expanding the public actor API; the visible chair/body overlap is a pose-quality issue, not evidence that a reusable engine state is needed yet.

**Verification.** `npx ng build demo-app` passed after the selected-state signal fix. `triangular docs records check` passed for 15 mapped and 22 legacy plans. The running demo page opened successfully, displayed the FPS panel and portal-lane controls, and rendered all three population sizes. Clicking Human 09 in a 16-character crowd selected them; clicking the ground then set that human to Walking. The rock was seen attached to the hand, and the chair interaction reached a seated pose; the new Sitting/Stand up state was confirmed. A visible 16-human snapshot showed 2,542 draw calls, 1,174,282 triangles and a 29.5 ms frame sample. A 48-human snapshot showed 7,582 draw calls, 3,521,930 triangles and a 68.2 ms frame sample. These were CPU-only in-app-browser observations, not controlled benchmarks or hardware baselines. The seated body overlaps the chair and needs visual refinement.

**Next.** Add the repeatable browser suite for point movement, pickup/drop, sit/stand and crowd selection. Use a device-specific 1/16/48 run before drawing performance conclusions or trying LOD; the current counts show that full-actor crowd rendering needs measurement and likely simplification.

## 2026-11-18 — Approved design to playable character

- **[finding]** The approved cream spacesuit and expressive pigtail heads are in Character Studio. The new body is a standing model. The sandbox already demonstrates movement, chair use and pickup on the earlier actor. See [ER 074](074_procedural-character-studio.md#2026-11-18--approved-full-body-spacesuit-in-character-studio) for the Studio verification.
- **[action]** Drafted a milestone tracker in [Plan 079](../plans/079_playable-capsule-human-sandbox.md#approved-capsule-human-v1-tracker) for bringing the new design into the sandbox. The first motion check is one clean walk with the approved model.

## 2026-11-19 — First walk on the approved Orange Pigtails

- **[action]** Added an Orange Pigtails walk mode to the playable sandbox. It uses the same cream suit and head builders as Character Studio. Distance traveled drives alternating planted boots and swinging sleeves. The walk slows into the original standing pose, and a second destination queues until the stop.
- **[verification]** All 12 focused Studio and walker specs passed, along with the library build. A live Chromium check clicked a 2.8 m destination, observed both boot lifts and held the contact boot within 0.1 mm across 34 sampled frames. The same check returned to the classic sandbox, exercised pickup/drop and sit/stand, switched to 16 humans, and reopened Orange Pigtails without browser errors. Local-only captures can be regenerated with `node artifacts/concept-turnaround/check-pigtail-walk.mjs`.
- **[next]** First walk is checked in the [tracker](../plans/079_playable-capsule-human-sandbox.md#approved-capsule-human-v1-tracker). The 45% checkpoint still requires running and smooth turns.

## 2026-11-19 — Swappable locomotion plugin rig & comparison harness

- **[decision]** Separated the approved Orange Pigtails rig from motion generation behind a fixed `CapsuleHumanPose` rig contract and a swappable `LocomotionPlugin` interface (with `GroundSampler` ready for rough terrain and a Phase-2 `ActionPlugin` + `PoseMask` slot reserved for interactions/dance). Kept this contract in `projects/demo-app` before promoting any public API into `triangular-engine`.
- **[action]** Upgraded `buildExperimentalPigtailBody()` with pelvis-pivoted torso rotation, collar-mounted `headSocket`, 3D limb bend vectors, sole-contact anti-clipping lift under boot pitch/roll, and hand prop sockets; added `setPigtailLag` secondary hair spring on `buildExperimentalPigtailHead()`. Implemented three comparable strategies (`baseline-distance`, `procedural-stepper`, `cartoon-keypose`), wired strategy buttons + deterministic 3-leg **Run course** + **3/4 cam** / **Side cam** + live slip/lift/speed telemetry into `/capsule-human-sandbox`, and wrote `MOTION_RACE_BRIEF.md` for independent agent entries.
- **[verification]** All 19 focused specs in `pigtail-sandbox-walker.spec.ts` and `experimental-pigtail-head.spec.ts` passed (`ChromeHeadless`). Both `npx ng build demo-app` and `npm run build:triangular-engine` succeeded with zero errors. Live Chromium check at `http://triangular-demo.localhost:4200/capsule-human-sandbox?character=orange-pigtails` confirmed zero console/page errors, visible FPS overlay, clean portal dock layout, strategy switching across all 3 plugins, 3-leg comparison course completion (`Step Planner` mid-course `Slip 0.0 mm · Lift 14.9 cm · Peak 1.24 m/s`; `Key-Pose Bounce` arrival `Slip 0.0 mm · Lift 14.0 cm · Peak 1.28 m/s`), `Side cam` / `3/4 cam` switching, and clean toggle to Classic sandbox and `/character-studio`.

## 2026-11-19 — Shaggy on the shared walk rig

- **[action]** Carried the [reviewed Shaggy proportions](074_procedural-character-studio.md#2026-11-19--capsule-parts-workshop) into the shared spacesuit builders. The sandbox Character picker switches between Shaggy, Orange Pigtails and Classic sandbox. Both spacesuit presets use the same walk strategies, course and cameras. The pose rig converts vertical world-space offsets using each preset's scale, so Shaggy's shorter suit keeps its boot contact and step lift.
- **[verification]** All 46 focused Studio and sandbox specs and the library build passed. The live Chromium check walked Shaggy to a clicked point, completed all three course legs on both spacesuit presets with Key-Pose Bounce, switched back to the Classic crowd controls, and checked the walk controls at 390 and 320 pixels without browser errors. The course recorded no planted boot slip or below-floor soles on either preset. Captures are local only. Regenerate with `node artifacts/concept-turnaround/check-shaggy-walk.mjs`.
- **[next]** Use a wave and a rock pickup to review the gloves in open-hand and gripping poses. The walk-and-run tracker still requires a run on the approved spacesuit.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-change id="SC-079-SANDBOX" date="2026-11-01" kind="addition" origin="requested" disposition="accepted" scope-ids="playable-sandbox,world-interactions,crowd-control,performance-cost-and-lod" -->

- Summary: Add a playable capsule-human sandbox with point movement, rock/chair interactions, crowd selection, and measured performance/LOD follow-up.
- Reason: The characters can currently be generated and reviewed but are not yet easy to use as game actors or evaluate as a crowd.
- Impact: Introduce a new demo route and a staged gameplay/performance effort that reuses Character Studio's actor and diagnostic matrix; keep studio creation and visual verification separate.
  <!-- /tri:scope-change -->
  <!-- tri:scope-change id="SC-079-VERIFY" date="2026-11-01" kind="addition" origin="requested" disposition="accepted" scope-ids="sandbox-visual-verification" -->

- Summary: Add deterministic browser visual-verification cases for movement, object interactions and crowd selection, with recorded evidence.
- Reason: A playable scene needs reviewable proof that its visible behavior works across later edits, for both people and agents.
- Impact: Add a dedicated verification phase; keep recorded artifacts separate from performance benchmarks and human visual verdicts.
  <!-- /tri:scope-change -->
  <!-- tri:scope-baseline state="unconfirmed" -->
  <!-- /tri:scope-baseline -->
  <!-- /tri:scope-history -->
