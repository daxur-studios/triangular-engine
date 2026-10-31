---
type: Plan
title: "Claude-specific coding approach: Haiku builds, Opus decides"
description: "Implementation goals and acceptance criteria."
timestamp: 2026-10-31T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/075_claude-coding-approach.md
map_schema: 1
document_id: plan-075
initiative_id: "claude-coding-approach"
performance: []
---

# Plan 075: Claude-specific coding approach: Haiku builds, Opus decides

Status: **planned**. Evidence and decisions: [ER 075](/docs/engineering-records/075_claude-coding-approach.md).

<!-- tri:scope -->

## Intended outcome

A repeatable, cost-aware way to build large features with Claude models: Haiku 5.5 implements, the main session briefs and reviews at wave boundaries, and Opus 5.5 is consulted only for the decisions that need its quality. Out of scope: changing any product code, and model pricing analysis.

## Phases and acceptance

- **roles** — Define who does what: Haiku implements one unit per agent; the main session writes briefs and reviews once per wave; Opus is a one-shot subagent fed a collated packet and never reads files. Acceptance: the roles, hand-offs and tool limits are written in the record.
- **brief-standard** — A brief is long and decided, not short: Haiku never invents a design choice. The report back is capped, the brief is not. Acceptance: the record holds the required brief sections.
- **opus-gates** — Three gates for Opus (define the critical parts before a unit family, review a finished wave's evidence, unblock a design fork), a packet format (about 3k tokens, answer about 40 lines) and a decision log. Acceptance: the record states the gates, the packet format and where decisions are logged.
- **review-and-cost** — Review rules (what the main session reads, what Haiku summarises) and cost levers (fresh session per wave, handover notes, capped reports). Acceptance: the record lists them and the lessons from the first use (Plan 059, G6).

## Relationships

- Evidence from first use: [Plan 059](/docs/plans/059_lod_surface_core.md), steps G6d to G6i.

<!-- /tri:scope -->

## Current phase status

| Phase           | State   |
| --------------- | ------- |
| roles           | planned |
| brief-standard  | planned |
| opus-gates      | planned |
| review-and-cost | planned |

<!-- tri:review version="1" scope-hash="55c486ab6c593202eaa9c0a16b81d782dd83f740781178a42329c9e935ba38f6" reviewed="2026-10-31" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="opus-gates" blocks="opus-gates" state="open" -->

- [ ] Is the Opus decision log kept in each feature's Engineering Record, or in one shared file?
  - Why it matters: a shared log is easier to hand to Opus cold; per-feature logs stay next to the evidence.
  - Next action: the developer decides after the first Opus gate (Plan 059, remaining critical parts).
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
