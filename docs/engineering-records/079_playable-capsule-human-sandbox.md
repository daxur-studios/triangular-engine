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
