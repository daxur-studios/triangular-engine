---
type: Plan
title: "Procedural character studio"
description: "A focused, extensible demo workspace for procedural characters."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/074_procedural-character-studio.md
map_schema: 1
document_id: plan-074
initiative_id: "procedural-character-studio"
performance: []
---

# Plan 074: Procedural character studio

Status: **in progress**. Evidence and decisions: [ER 074](/docs/engineering-records/074_procedural-character-studio.md).

<!-- tri:scope -->

## Intended outcome

Give capsule humans and cats a dedicated, full-screen studio in the demo app. The studio shell presents a large character viewport with focused selection and editing controls, and keeps the character-specific verification workflow close to the characters being reviewed. Begin with an app-owned extension seam for the capsule human and cat; keep the existing engine character and procedural APIs independently usable.

This plan covers separating the capsule character experience from the mixed-purpose Characters Lab and scaffolding an app-local contribution model. A public studio/plugin API, themed clothing and equipment packs, new anatomy systems, authoring persistence, and concept-art tracing remain future work.

## Phases and acceptance

- **studio-shell** — Add a dedicated `/character-studio` route and full-screen responsive workbench shell with a clear human/cat selector and a large scene viewport. Acceptance: both capsule families can be selected and displayed in the new route; the route is discoverable in the demo selector; existing `/characters-lab` remains available during migration.
- **family-contributions** — Represent capsule humans and cats as app-local studio contributions that supply identity, presets, actor lifecycle, supported controls and visual test suites. Acceptance: each family owns its settings and cleanup through the contribution boundary, and shared shell actions do not depend on human- or cat-specific DNA fields.
- **verification-workflow** — Move capsule visual, face-detail and variant suites into the studio's verification surface with the recording/evidence workflow intact. Acceptance: the existing capsule suites remain reproducible and save the same review-friendly artifacts from the studio route.
- **legacy-lab-separation** — Remove capsule customization from `/characters-lab` after its tests and evidence workflow have moved. Acceptance: `/characters-lab` continues to host its face-rig and general humanoid demonstrations without duplicate capsule controls or suites.
- **hair-generation-coverage** — Add deterministic, close-up visual verification for procedural human hairstyles across representative presets and head views. Acceptance: reviewed front, side and rear evidence covers the selected generated styles and identifies attachment, silhouette, coverage, floating or head-intersection issues; fixes can be reproduced from the recorded recipe.
- **hair-motion-and-helmet** — Verify representative hairstyles during walking and inside a clear dome-style space helmet. Acceptance: focused motion and helmet-fit cases produce reviewable close-up evidence, define expected hair movement and helmet interaction, and pass human review for unintended clipping, occlusion or detachment; implement any behavior changes established by that review.

## Relationships

- **builds-on**: [Plan 073: Visual verification evidence and retention](/docs/plans/073_visual-verification-evidence-retention.md)

<!-- /tri:scope -->

## Current phase status

| Phase                  | State       |
| ---------------------- | ----------- |
| studio-shell           | in_progress |
| family-contributions   | in_progress |
| verification-workflow  | planned     |
| legacy-lab-separation  | planned     |
| hair-generation-coverage | planned   |
| hair-motion-and-helmet | planned     |

<!-- tri:review version="1" scope-hash="4f44eb20469145052888ec56cbd9f46a73cc9cdecfed0050fd5eae04eb428fce" reviewed="2026-10-31" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

The first delivery is an app-local shell and human/cat selection path. The initial route, family contributions, presets, expressions, motions and appearance/gear controls are scaffolded; runtime validation remains open. Preserve the existing staged workspace changes. Broader themed character packs and promotion of the contribution contract into a public engine entry point require later evidence and scope review.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
