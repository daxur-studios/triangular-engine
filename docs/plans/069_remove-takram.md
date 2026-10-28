---
type: Plan
title: "Remove Takram integration from the engine"
description: "Remove every Takram dependency from triangular-engine; keep the demo code, excluded from compilation."
timestamp: 2026-10-28T00:00:00Z
tags: [engineering-records]
runbook: /docs/runbook/069_remove-takram.md
map_schema: 1
document_id: plan-069
initiative_id: "remove-takram"
performance: []
---

# Plan 069: Remove Takram integration from the engine

Status: **done (pending verification)**. Evidence and decisions: [ER 069](/docs/runbook/069_remove-takram.md).

## Intended outcome

`triangular-engine` has no Takram code and no `@takram/*` peer dependencies. The root and engine
manifests no longer declare `@takram/three-atmosphere`, `@takram/three-clouds` or
`@takram/three-geospatial`, so the `react` chain they pulled in leaves the lock as well (see
[ER 069](/docs/runbook/069_remove-takram.md)). The demo's Takram pages are kept under
`projects/demo-app/deprecated/`, outside `src/`, so they are not compiled. Their routes and index
cards remain as deprecated placeholders.

Out of scope: rewriting the Takram demos on another atmosphere or cloud implementation; the
historical plans and records that mention Takram stay as they are.

<!-- tri:scope -->

## Phases and acceptance

- **engine-removal** — Move `projects/triangular-engine/takram/` and its adapter spec to
  `projects/demo-app/deprecated/takram-engine/`; remove the `triangular-engine/takram` path,
  peer dependencies, notices and docs. Acceptance: `git grep -i takram` finds no reference in the
  engine outside `docs/` history; the engine builds.
- **demo-removal** — Move the Takram demo pages, shared controls and spike to
  `projects/demo-app/deprecated/demo/`; route their paths to a deprecated placeholder page; mark
  their index cards deprecated; remove the Takram asset copy from `angular.json`. Acceptance: the
  demo builds and the index shows the deprecated cards.

## Relationships

- Record: [ER 069](/docs/runbook/069_remove-takram.md).

<!-- /tri:scope -->

## Current phase status

| Phase           | State                |
| --------------- | -------------------- |
| engine-removal  | done, pending checks |
| demo-removal    | done, pending checks |

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
