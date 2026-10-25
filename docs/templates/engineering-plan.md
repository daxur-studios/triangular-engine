---
type: Plan
title: "{{TITLE_YAML}}"
description: "{{DESCRIPTION_YAML}}"
timestamp: {{DATE}}T00:00:00Z
tags: [engineering-records]
runbook: /docs/runbook/{{NUMBER}}_{{SLUG}}.md
map_schema: 1
document_id: plan-{{NUMBER}}
initiative_id: "{{INITIATIVE_ID}}"
performance: []
---

# Plan {{NUMBER}}: {{TITLE}}

Status: **planned**. Evidence and decisions: [ER {{NUMBER}}](/docs/runbook/{{NUMBER}}_{{SLUG}}.md).

## Intended outcome

Describe the user-visible or developer-visible result. State important constraints and what is out of scope.

<!-- tri:scope -->

## Phases and acceptance

- **phase-id** — Work in this phase. Acceptance: observable conditions that demonstrate the result.

## Relationships

<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->
<!-- /tri:scope -->

## Current phase status

| Phase    | State   |
| -------- | ------- |
| phase-id | planned |

<!-- tri:review version="1" scope-hash="pending" reviewed="{{DATE}}" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="phase-id" blocks="phase-id" state="open" -->

- [ ] State one consequential question or assumption in concrete terms.
  - Why it matters: describe what changes if this is interpreted differently.
  - Next action: state who investigates, decides, or records the answer.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
