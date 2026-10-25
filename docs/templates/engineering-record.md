---
type: Runbook
title: "{{TITLE}}"
description: "Dated decisions, findings and evidence for {{TITLE}}."
timestamp: {{DATE}}T00:00:00Z
tags: [engineering-records]
record_id: er-{{NUMBER}}
scope_history_schema: 1
plans:
  - /docs/plans/{{NUMBER}}_{{SLUG}}.md
performance: []
---

# Engineering Record {{NUMBER}}: {{TITLE}}

Plan: [PLAN-{{NUMBER}}](/docs/plans/{{NUMBER}}_{{SLUG}}.md).

## {{DATE}} — Starting

**Goal.** {{DESCRIPTION}}

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/{{NUMBER}}_{{SLUG}}.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
