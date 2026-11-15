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

Run useful bounded multi-model, multi-provider discussions that expose blind spots, challenge assumptions and preserve disagreement, with selected code available for read-only investigation. Save attributed turns and actionable outcomes, prevent uncontrolled calls and edits, and report provider-specific usage honestly. Visual replay is secondary; the preferred review experience is a generated video presented using the share-media-in-chat skill standards. Automatic compaction is later work.

## Phases and acceptance

- **coordinator** — Run and save bounded conversations. Acceptance: independent opening turns, shared later turns, validated metadata, recoverable partial output, per-participant and overall call limits, deadline and reported usage.
- **providers** — Add provider adapters with verified restrictions. Acceptance: each enabled CLI resumes its own session and cannot make code changes through its model tools.
- **discussion value** — Test a substantive mixed-provider discussion and assess whether it surfaces useful blind spots, evidence, unresolved disagreement and actionable next steps; retain attributed positions independently of any summary.
- **scene** — Support discussion review with a generated video presented using the share-media-in-chat skill standards. Replay and capsule movement visualize recorded agreement and readiness, but visual polish and voting are secondary to useful outcomes.

## Relationships

<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| coordinator | in_progress |
| providers | in_progress |
| discussion value | planned |
| scene | in_progress |

<!-- tri:review version="1" scope-hash="1b1b46586f523e7c430688406072a32b57d086d1f278c3fbb0c6eae9957c779a" reviewed="2026-11-14" reviewer="agent" -->
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
