---
type: EngineeringRecord
title: "Visual verification evidence and retention"
description: "Dated decisions, findings and evidence for visual verification evidence and retention."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-073
scope_history_schema: 1
plans:
  - /docs/plans/073_visual-verification-evidence-retention.md
performance: []
---

# Engineering Record 073: Visual verification evidence and retention

Plan: [PLAN-073](/docs/plans/073_visual-verification-evidence-retention.md).

## 2026-10-31 — Starting

**Goal.** Build a reusable visual-verification workflow for the engine demo and consumer games, with reproducible scene evidence, on-demand review media, separate human/agent assessments and bounded local artifact retention.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/073_visual-verification-evidence-retention.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## 2026-10-31 — Follow-up scope from test-recording POC

Plan 073 builds on completed [Plan 072](/docs/plans/072_testing-video-recordings.md), which established opt-in browser recordings and explicitly left transcoding out of scope. The user clarified that deterministic test runs can regenerate recordings; short-lived media therefore may serve as session evidence for review and sharing, while the test definition, source fingerprint, seed/settings and compact review history are retained as the regeneration recipe and audit trail.

The proposed workflow covers more than playback. A host game can define camera orbits and animation phases; a run can produce video plus labeled contact/sprite sheets suited to targeted human or agent review. GIFs are optional on-demand derivatives for clients that display animated images but not video. Vector highlights should be a separate toggleable layer tied to scene/frame evidence; a target highlight must not imply that the area passed review. Human and agent reviews remain separately attributed from automated verdicts.

The initial retention proposal is a configurable per-app 1 GiB media budget, a seven-day TTL for unpinned media, and oldest generated GIF/contact-sheet derivatives pruned before oldest unpinned videos. Bookmarks would protect selected media. These values and the safety of regeneration after expiry remain open; do not treat this proposal as approval for automatic deletion. See Q1 in the plan.

**Action.** Create the reusable contract and artifact-policy plan before implementation. Keep the demo and each consumer app's output directory independently managed by the triangular CLI; preserve run/review metadata when media files expire.

**Checks.** `triangular docs plan new` created the reciprocal PLAN-073 / ER 073 pair and updated both indexes. Run mapped-document validation after completing the scope review.

## 2026-10-31 — Capsule Characters Lab evidence proof of concept

**Change.** Added the `capsule-visual-verification@v1` suite to the demo's Characters Lab. It runs a procedural capsule human walk and a capsule cat goofy walk, with a deterministic horizontal camera turn followed by a vertical elevation sweep. The existing opt-in recording control captures each case at 960×540, 20 fps, preserving the source canvas aspect ratio. The host adapter also snapshots/restores the page's selected character, layout, camera and actor yaw around the run.

**Verification.** `npx ng test demo-app --watch=false --browsers=ChromeHeadless --include projects/demo-app/src/app/pages/characters-lab/characters-lab-test-adapter.spec.ts` passed (7/7). A visible-browser quick run completed with 2 valid cases, 0 invalid cases and 0 failures. The saved result is `artifacts/test-runs/capsule-visual-verification@v1/2026-10-31T04-11-16-689Z_visible-browser_quick_3eda5891-e3b0c442.json`. It contains two silent WebM recordings, each 9.1 seconds at 960×540: human 202,768 bytes; cat 199,160 bytes; total 401,928 bytes (about 393 KiB). The test summary reports `auto=pass`, `visual=pending`; no visual verdict was recorded. Visible-browser frame timings are diagnostic and are not performance claims.

The first run revealed that the human test settings used a stale preset ID (`wacky-hair-cosmonaut`); the actual ID is `wacky-helmet-waver`. Correcting the setting made the full run pass. The separately saved first run remains available as the failed-result history.

**Status and next work.** The `reproducible-evidence` phase is in progress. This demo proves scene-specific motion paths and opt-in video capture, but the acceptance scope still includes richer recipe metadata and an equivalent consumer-style adapter example. On-demand GIF/contact/sprite-sheet generation and artifact inventory/retention are not implemented. Q1 remains open, so this work does not enable automatic deletion.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
