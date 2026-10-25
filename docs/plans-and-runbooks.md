---
type: Standard
title: Plans and Runbooks
description: Link current implementation plans to dated decisions and verification evidence.
timestamp: 2026-10-13T00:00:00Z
tags: [documentation, plans, runbook]
performance: []
---

# Plans and Runbooks

Each active initiative uses a plan in `docs/plans/` and an append-only runbook in `docs/runbook/`. The plan's `runbook:` and runbook's `plans:` references are reciprocal; the first pair shares its numbered filename. Plans show current tasks/status, runbooks record dated findings/decisions/actions/checks, and both indexes include new pairs. Preserve the existing legacy runbooks as history.

## Runnable experiment history

Every new or substantively updated spike, plan and runbook carries an append-only
`performance` array. Keep literal arrays in paired documents consistent for now;
no manifest resolver or document-viewer button is implemented. Historical pages
are updated when touched, without a repository-wide backfill.

Use `performance: []` until an actual scenario and verified launch link exist.
Runnable entries identify the experiment, suite/version, URL, availability and
evidence references. Preserve older versions and failed/inconclusive results;
the final entry is latest, not the fastest or most successful. A blocked latest
entry keeps its blocker rather than silently selecting an older test.

The host page uses `triangular-engine/testing` to expose **Run latest test** and
exact-version reruns; Markdown plans/runbooks expose corresponding launch links.
Follow the [testing guide](../projects/triangular-engine/testing/README.md) for
current contracts and profiles. Agents author and exercise these scenarios;
"visit the page and inspect it" is not a complete feature handoff. Builds/unit
tests, controlled performance evidence and explicit human visual acceptance
remain distinct. This standard page has no scenario of its own.
