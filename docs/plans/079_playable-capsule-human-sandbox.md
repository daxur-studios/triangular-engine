---
type: Plan
title: "Playable Capsule Human Sandbox"
description: "Use procedural capsule humans in a small interactive scene and measure their scaling cost."
timestamp: 2026-11-01T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/079_playable-capsule-human-sandbox.md
map_schema: 1
document_id: plan-079
initiative_id: "playable-capsule-human-sandbox"
performance: []
---

# Plan 079: Playable Capsule Human Sandbox

Status: **in progress**. Evidence and decisions: [ER 079](/docs/engineering-records/079_playable-capsule-human-sandbox.md).

<!-- tri:scope -->

## Intended outcome

Make capsule humans feel usable as game characters in a focused demo scene: move a selected human to a point, perform a couple of simple world interactions, and later control a small crowd. Keep the playable sandbox separate from Character Studio, which remains the place to create, customize and visually inspect characters. Build on the existing actor and performance matrix before changing engine character APIs.

First establish one human moving and interacting in a small fixed scene. Crowd controls, per-part cost attribution and distance LOD follow as measurable phases. A game-ready navigation system, physics-driven interaction framework, persistence, combat and public gameplay plugin API are out of scope.

## Phases and acceptance

- **playable-sandbox** — Add a discoverable `/capsule-human-sandbox` page with a procedural human, ground, orbit camera and compact controls. Acceptance: the page opens from the demo index, renders its scene with FPS shown, and lets the user select the human and issue a ground-point movement command.
- **world-interactions** — Add approach-and-pick-up for a rock and approach/sit/stand for a chair. Acceptance: each interaction is visibly completed by the human in a repeatable scene; the rock can be dropped/reset and the chair interaction can be exited without breaking movement.
- **crowd-control** — Add adjustable small and larger populations, individual selection and point movement for the selected human. Acceptance: a crowd is visible at once, selection is unambiguous, and moving one actor does not redirect the others.
- **sandbox-visual-verification** — Add repeatable browser cases for movement, pickup/drop, sit/stand and crowd selection. Acceptance: each case can produce reviewable recordings and stills from a deterministic scene setup; generated evidence supports human and agent review without treating automated completion as visual approval.
- **performance-cost-and-lod** — Extend the existing controlled performance evidence to compare one and many full actors, isolate the largest render/update contributors where practical, then evaluate distance-based simplification. Acceptance: repeatable device-specific results report frame cadence, actor-update and render-submit CPU, draw calls and triangles; any LOD change has before/after evidence and preserves near-view quality. Do not claim a hardware-independent cost or performance baseline.

## Relationships

- **builds-on**: [Plan 074: Procedural character studio](/docs/plans/074_procedural-character-studio.md)

<!-- /tri:scope -->

## Current phase status

| Phase                       | State       |
| --------------------------- | ----------- |
| playable-sandbox            | done        |
| world-interactions          | in_progress |
| crowd-control               | in_progress |
| sandbox-visual-verification | planned     |
| performance-cost-and-lod    | planned     |

<!-- tri:review version="1" scope-hash="8bfa65e284b82f6c87aa0e3b14a4cf09598c4c979c33ec0741bf98baf4db3e13" reviewed="2026-11-01" reviewer="agent" -->
<!-- tri:item id="A1" kind="investigation" applies-to="world-interactions" blocks="world-interactions" state="resolved" -->

- [x] Check whether the current capsule actor can support a readable seated pose through an app-level adapter or needs a character API change.
  - Why it matters: the actor currently exposes idle/walk/run/float locomotion but no sit mode, so the interaction could otherwise be only a label or an unconvincing pose.
  - Resolution: the sandbox applies a reversible procedural pose at the app layer, so no public actor API change is needed for this prototype. Refine the chair fit and revisit a reusable sit mode only if another consumer needs it.
  - Next action: improve the chair fit in the sandbox; reconsider a public sit mode only if another consumer requires it.
    <!-- /tri:item -->
    <!-- tri:item id="A2" kind="investigation" applies-to="performance-cost-and-lod" blocks="none" state="open" -->

- [ ] Find a repeatable way to attribute render cost to actor parts before choosing a distance LOD representation.
  - Why it matters: total frame time alone cannot tell whether hair, face, gear, limbs or draw-call count is the useful optimization target.
  - Next action: use the existing performance suite and actor group boundaries to compare controlled variants on the intended device.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

The first implementation slice now includes a playable scene, point-and-click movement, rock pickup/drop, chair sit/stand and 1/16/48 actor controls. Plan 074 already contains a diagnostic Character Studio matrix at 1, 16 and 48 humans; this plan will reuse its measurement approach and preserve separation between functional behavior, performance results and human visual review. The scene still needs a repeatable browser suite and a clean intended-device run.
