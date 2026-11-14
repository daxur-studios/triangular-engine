---
type: Plan
title: "Multi-turn consensus conversations"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-11-14T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/087_multi-turn-consensus-conversations.md
map_schema: 1
document_id: plan-087
initiative_id: "multi-turn-consensus-conversations"
performance: []
---

# Plan 087: Multi-turn consensus conversations

Status: **in progress**. Evidence and decisions: [ER 087](/docs/engineering-records/087_multi-turn-consensus-conversations.md).

<!-- tri:scope -->

## Intended outcome

Run bounded multi-turn discussions in separate model sessions, save attributed turns and agreement metadata for replay, and provide selected code as read-only context. Prevent uncontrolled calls and edits; report provider-specific usage honestly. The capsule scene and automatic compaction are later work.

## Phases and acceptance

- **coordinator** — Run and save bounded conversations. Acceptance: independent opening turns, shared later turns, validated metadata, recoverable partial output, per-participant and overall call limits, deadline and reported usage.
- **providers** — Add provider adapters with verified restrictions. Acceptance: each enabled CLI resumes its own session and cannot make code changes through its model tools.
- **scene** — Replay saved conversations with visible agreement and readiness. Acceptance: capsules move based on recorded metadata and preserve disagreement.

## Relationships

<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| coordinator | in_progress |
| providers | in_progress |
| scene | in_progress |

<!-- tri:review version="1" scope-hash="66bb896e1f302525eb7e453af37d09b3d88f6c4204660e4b67ea62e222c459ba" reviewed="2026-11-14" reviewer="agent" -->
<!-- tri:item id="Q1" kind="investigation" applies-to="providers" blocks="providers" state="open" -->

- [ ] Establish enforceable read-only restrictions for each provider CLI.
  - Why it matters: instructions alone do not prevent model tools from changing files.
  - Next action: verify each provider's settings and test denied writes before enabling it.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
