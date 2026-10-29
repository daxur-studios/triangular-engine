---
type: Plan
title: "Triangular CLI and Consensus Reviews"
description: "Provide a portable Triangular CLI for project documents, consensus reviews and testing workflows."
timestamp: 2026-10-29T00:00:00Z
tags: [engineering-records]
runbook: /docs/runbook/071_triangular-cli-consensus-reviews.md
map_schema: 1
document_id: plan-071
initiative_id: "triangular-cli-consensus-reviews"
performance: []
---

# Plan 071: Triangular CLI and Consensus Reviews

Status: **M1–M2 complete; M3–M4 in progress**. Evidence and decisions: [ER 071](/docs/runbook/071_triangular-cli-consensus-reviews.md).

<!-- tri:scope -->

## Intended outcome

Developers can install one `triangular` command and use it in the Triangular workspace or another
project. `triangular docs` creates and checks durable Markdown records, `triangular docs consensus`
supports independent agent reviews and explicit experiment-needed outcomes, and `triangular testing`
groups the existing test runner tools. Consensus files preserve agent contributions and distinguish
their recommendations from developer decisions.

Consensus reviews use a separate per-project `C001` sequence and stable slug key. This permits
multiple reviews for one Plan, makes repeated creation idempotent, and allows a review to start
before its implementation Plan exists.

The CLI targets the current project or an explicit `--root`. It handles files and prompt generation;
the calling agent or skill coordinates model participants. Existing `triangular-test-*` commands stay
available for compatibility.

## Phases and acceptance

- **m1** — Define the consensus review format and contributor workflow. Acceptance: one Markdown file can preserve a frozen brief, independent round-one contributions, optional round-two critique, synthesis, experiment/spike criteria, and a separate developer decision; outcomes can be a recommendation, contenders, needs-evidence, or unresolved.
- **m2** — Add the official `triangular` command dispatcher with `docs` and `testing` namespaces. Acceptance: the built package exposes the command; test tools remain directly callable and are reachable through `triangular testing`; documentation commands target the current directory or `--root` without requiring Angular or Three.js at runtime.
- **m3** — Add idempotent consensus file creation, prompt generation, contribution updates and validation. Acceptance: stable review slugs and the separate `C001` sequence prevent duplicate files; repeating creation leaves existing contributions untouched; rounds are preserved; generated prompts use the same frozen brief; an agent can record a recommendation, competing contenders, or a required spike with pass/fail criteria.
- **m4** — Package the existing plan/Engineering Record helper and a CLI skill, document the command tree, and exercise the workflow in this repository and a plain consumer-project fixture. Acceptance: `triangular docs records` retains existing numbering/retention safeguards; installed templates and instructions work outside the engine source tree; the skill coordinates agents without depending on provider-specific APIs.

## Relationships

<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| m1       | done |
| m2       | done |
| m3       | in_progress |
| m4       | in_progress |

<!-- tri:review version="1" scope-hash="06b796bb0135dc63eefca188b7ea68ec1e2f33efa0ce0b34b7144b71023c4d0d" reviewed="2026-10-29" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="m4" blocks="none" state="open" -->

- [ ] Which additional document types should the first CLI release create beyond consensus reviews and paired Plans/Engineering Records?
  - Why it matters: spike and example conventions differ across projects, and adding them now may delay the portable review workflow.
  - Next action: use the first consumer-project pilot to identify the next highest-friction document type.
    <!-- /tri:item -->
<!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
