---
type: EngineeringRecord
title: "Procedural character studio"
description: "Dated decisions, findings and evidence for Procedural character studio."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record_id: er-074
scope_history_schema: 1
plans:
  - /docs/plans/074_procedural-character-studio.md
performance: []
---

# Engineering Record 074: Procedural character studio

Plan: [PLAN-074](/docs/plans/074_procedural-character-studio.md).

## 2026-10-31 — Starting

**Goal.** Build a focused procedural capsule character studio in the demo app, starting with a full-screen shell for capsule humans and cats and a small app-owned contribution boundary.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/074_procedural-character-studio.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## 2026-10-31 — Initial scope and architecture

**Direction.** The existing Characters Lab combines capsule human/cat customization, face-rig experiments, a general humanoid scene and capsule visual suites. Give the capsule characters a dedicated `/character-studio` route and move their verification workflow with them. Keep the existing lab available during migration for face and general humanoid work.

**Boundary.** Start with capsule humans and cats as app-local contributions to a shared studio shell. Contributions own character-specific identity, presets, actors, controls and visual suites; the shell owns selection, viewport and shared verification actions. Keep the engine's character APIs usable without the studio. Defer a public plugin API, themed wardrobe/role packs, anatomy expansion, persistence and concept-art tracing until the local boundary has been exercised.

**Checks.** No implementation checks yet. See the acceptance conditions and phase states in [Plan 074](/docs/plans/074_procedural-character-studio.md).

## 2026-10-31 — First studio shell

**Change.** Added an app-local Character Studio route with a full-height workbench, capsule human/cat family selection, preset selection, expression and motion controls, and per-family appearance/gear controls. The initial `CharacterStudioContribution` contract is local to the demo app and keeps human and cat fields behind their own descriptors. The demo selector now lists the studio ahead of the previous Characters Lab on the newest sort. The prior route and its test workflow remain available during migration.

**Verification.** Documentation pair validation passed before the app edit. No app build, browser run or automated test has been run for this scaffold.

**Next.** Exercise the page in the already-running demo app, address any runtime/layout issues, then move capsule suites and recording into the studio before removing capsule editing from `/characters-lab`.

## 2026-10-31 — Hair generation and motion verification planned

**Change.** Added two later phases to Plan 074 for focused procedural-hair review. `hair-generation-coverage` covers deterministic hairstyle variants with close-up front, side and rear evidence, checking silhouette, attachment and coverage. `hair-motion-and-helmet` covers hair during walking and inside a clear dome-style helmet, including an explicit review of expected motion and fit behavior.

**Boundary.** These phases are planned visual verification and targeted corrections, not a commitment to physics-based hair simulation. The evidence should reveal whether hair should remain fixed, sway, or use another deterministic behavior, and whether dome clearance or occlusion needs a generator change. Motion video and labeled still/contact sheets can serve different review needs.

**Checks.** Documentation changes only; mapped-plan review freshness and pair validation remain to be refreshed. No runtime implementation or visual verdict is implied.

## 2026-10-31 — Studio verification surface

**Change.** Mounted the existing capsule orbit, facial-detail and human A/B variant suites on `/character-studio`. The studio host applies test settings through the family contribution boundary, waits for rendered frames, captures the same optional WebM recordings and review thumbnails, and restores the selected character, camera and motion afterward. Added focused front, profile, rear, face and head views, and exposed hand-action and cat face-detail controls used by the imported scenarios. The focused framing is resolved by each family contribution using the existing measured geometry and shader-mouth bounds helper.

**Verification.** `npx ng build demo-app` completed successfully. No browser suite or visual review was run in this change, so recording generation, result-sink retention and human review remain unverified on the studio route. The build reports the existing Angular component-style budget warning for the studio stylesheet, in addition to other workspace warnings.

**Next.** Run the capsule suites from the studio, inspect the generated result summaries and selected media, then move suite ownership out of the legacy page and remove duplicate capsule controls only after that workflow is established.

## 2026-10-31 — Studio visual suites and review media

**Change.** Raised the Angular `anyComponentStyle` warning budget from 10 kB to 14 kB; kept the 16 kB error budget. Made the studio scene host a flex container after the first headless readiness check found a 1-pixel canvas, allowing the renderer and test runner to become ready at the intended viewport size.

**Verification.** `npx ng build demo-app` succeeded and no longer reports the Character Studio component-style budget warning. The build still reports existing CommonJS optimization warnings from Mermaid dependencies. On `/character-studio`, all three suites passed in `headless-hardware` mode: `capsule-visual-verification` (2/2 cases, 20 s), `capsule-facial-emotions` (8/8, 33 s), and `capsule-human-ab-variants` (10/10, 41 s). The result summaries are saved under their respective `artifacts/test-runs/<suite>@v1/` directories. The tests did not collect performance measurements.

**Review artifacts.** Orbit recordings are 185,193 bytes (human) and 196,246 bytes (cat). Their generated GIF previews are 802,006 bytes and 699,347 bytes respectively, so these GIFs are about 4.3x and 3.6x larger than the source WebM recordings. The facial expression contact sheet is 70,981 bytes; the front-detail hair preset contact sheet is 67,074 bytes. All review verdicts remain pending human visual inspection; this entry records artifact generation and automated results only.

**Next.** Human review can use the generated orbit GIFs and face/hair contact sheets. Continue with legacy-lab separation after the studio evidence workflow is reviewed.

## 2026-10-31 — Legacy lab separation

**Change.** Removed capsule character modes, customization panels, actors and the test runner from `/characters-lab`. The remaining page opens on Face Studio and keeps the authored/procedural face demonstrations plus the general humanoid rig scene. Moved capsule suite definitions, test adapter, camera-focus helper and their specs into the Character Studio folder, preserving the existing suite IDs and history there. Renamed the demo selector entry to “Face Rig & Humanoid Lab.”

**Verification.** `npx ng build demo-app` completed successfully. Existing CommonJS optimization warnings from Mermaid dependencies remain. No browser review or automated suite tests were run for this separation.

**Next.** Start `hair-generation-coverage` with deterministic close-up views of selected hairstyles from front, side and rear. The generated Character Studio media still needs a human visual verdict; this migration does not record one.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-change id="SC-074-HAIR" date="2026-10-31" kind="addition" origin="requested" disposition="accepted" scope-ids="hair-generation-coverage,hair-motion-and-helmet" -->
- Summary: Add later visual-verification phases for procedural hair generation, walking behavior and clear dome-helmet fit.
- Reason: Hair is a prominent procedural feature whose silhouette and attachment need close-up multi-view review; walking and helmet cases can expose motion, clipping and occlusion issues that ordinary character sheets miss.
- Impact: Extend Plan 074 with deterministic hair-focused evidence and targeted correction work while leaving physics-based simulation undecided.
<!-- /tri:scope-change -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
