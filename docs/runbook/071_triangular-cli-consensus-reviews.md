---
type: Runbook
title: "Triangular CLI and Consensus Reviews"
description: "Dated decisions, findings and evidence for the portable Triangular CLI and consensus review workflow."
timestamp: 2026-10-29T00:00:00Z
tags: [engineering-records]
record_id: er-071
scope_history_schema: 1
plans:
  - /docs/plans/071_triangular-cli-consensus-reviews.md
performance: []
---

# Engineering Record 071: Triangular CLI and Consensus Reviews

Plan: [PLAN-071](/docs/plans/071_triangular-cli-consensus-reviews.md).

## 2026-10-29 — Starting

**Goal.** Provide a globally installable `triangular` CLI with project-root-aware `docs` and `testing`
commands, and a consensus review workflow that preserves independent agent opinions and developer decisions.

**Open decisions and assumptions.** See the current scoped review in [the plan](/docs/plans/071_triangular-cli-consensus-reviews.md).

**Checks.** Record commands and observable outcomes. Keep functional, performance and human visual evidence distinct.

## 2026-10-29 — Initial architecture

- The package's executable will be `triangular`, with `triangular docs ...` and
  `triangular testing ...` command families.
- Consensus files represent one decision each. All agent rounds remain in that file; multiple agents
  contribute to the same review. A separate stable ID makes creation idempotent.
- Reviews use a per-project `C001` sequence, independent of Plan/ER numbers, and a stable slug key.
  This supports multiple reviews attached to one plan and reviews that precede a plan.
- Valid review outcomes include one recommendation, multiple contenders, a required experiment/spike
  with pass/fail criteria, or unresolved disagreement. None imply developer approval.
- The CLI owns local file creation, prompt generation, safe updates and checks. Agent orchestration
  belongs in the CLI skill or the current AI session, not a provider-specific CLI integration.
- Start by shipping the command in `triangular-engine` with a `--root` option. Consider extraction
  to a standalone package only if projects outside this ecosystem need it without the engine package.
- Existing `triangular-test-*` binaries and the numbered Plan/Engineering Record workflow remain
  supported.

## 2026-10-29 — CLI scaffolding and package verification

- Added the `triangular` executable with `docs` and `testing` command families. The package now
  carries the consensus and Engineering Record helpers, Markdown templates and `triangular-cli`
  skill. The workspace helper path remains as a wrapper for existing scripts and imports.
- Added index templates so `triangular docs plan new` can initialize the Plan and Engineering Record
  indexes in a new consumer project while preserving any existing indexes.
- `npm run build:triangular-engine` and `npm pack --dry-run` succeeded. The package preview includes
  the executable, helpers, templates and skill. An isolated consumer-root smoke check created
  PLAN/ER 001, initialized both indexes, created Consensus C001 and listed it. The check first
  exposed the missing-index case; the helper was updated before the successful retry.
- `node scripts/engineering-records.mjs check` passed: 6 mapped documents and 23 legacy plans.
  Full prompt/response rounds and consensus creation idempotency remain to be exercised. No automated
  test suites were run in this implementation pass.

## History

Append dated findings, decisions, scope changes and verification. Do not erase earlier outcomes when a plan is superseded.

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
