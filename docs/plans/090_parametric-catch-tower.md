---
type: Plan
title: "Parametric catch tower asset"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-11-24T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/090_parametric-catch-tower.md
map_schema: 1
document_id: plan-090
initiative_id: "parametric-catch-tower"
performance: []
---

# Plan 090: Parametric catch tower asset

Status: **first pass verified**. Evidence and decisions: [ER 090](/docs/engineering-records/090_parametric-catch-tower.md).

<!-- tri:scope -->

## Intended outcome

Build a Flight 5-inspired game catch-tower study with a detailed mirrored pair of parametric catch arms, a separate lift carriage and a simple braced mast. Keep the stock booster contact dimensions and sliding fit. Provide a hinged V sweep and a lifting carriage in the baked preview. Production integration and physics changes are outside this study.

## Phases and acceptance

- **asset** — Author the parts in millimetres, Z-up. Acceptance: both handed arms and the fixed parts verify, the key parameter variants keep the contact and attachment datums, and the GLBs measure in metres, Y-up.
- **preview** — Provide an orbitable comparison. Acceptance: see both pins seat and the open gap, check front, side and top views, and exercise the carriage and V-shaped sweep.

## Relationships

- Builds on [Plan 089](/docs/plans/089_brepjs_poc.md), the BRep authoring study.
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| asset    | done |
| preview  | done |

<!-- tri:review version="1" scope-hash="f0d48a6380f41a3f658a93bcb71db390eb9e926bd85f15cae326646e1599b38e" reviewed="2026-11-24" reviewer="agent" -->
<!-- /tri:review -->

## Delivery progress

The first-pass asset and comparison are ready for visual review before the tower is detailed. Build and verification instructions are in the [study](/projects/brep-poc/studies/catch-tower/README.md).

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
