---
type: Plan
title: Test Results Page and Case Thumbnails
description: A browsable page of saved browser test runs (list, run detail with the change from a baseline, side-by-side compare) with small untimed thumbnails per case, built on the testing entry and its local receiver.
timestamp: 2026-10-20T00:00:00Z
tags: [testing, results, thumbnails, receiver, demo-app, tooling]
runbook: /docs/runbook/058_test_results_page_and_thumbnails.md
performance: []
---

# Plan 058: Test Results Page and Case Thumbnails

Status: **built, pending owner visual review.** Evidence: [Runbook 058](/docs/runbook/058_test_results_page_and_thumbnails.md).

**Goal:** see past runs at a glance, and see what each test looked at, without opening result JSON. Thumbnails are a
helper for the human reader; they never enter a timing window.

Builds on [Plan 052](/docs/plans/052_page_test_sessions_and_performance_comparison.md) (runner, receiver, summary)
and on the run modes, focus-loss redo, A/B suites and agent hand-off already in the working tree. Budgets and targets
are a separate task (Plan 055 Phase 0); until then the page shows the change from a chosen baseline run.

## Scope

| # | Item | Status |
|---|---|---|
| 1 | Adapter hook `thumbnail?(scenario, context): Promise<Blob[] \| undefined>`, called by `TestSession` after `measure` for a kept case; run option and `testThumbnails` launch parameter to turn it off | done |
| 2 | Runner sends the images with the result; the receiver stores them next to it, keeps relative names in the JSON and index, enforces about 64 KB per image and 2 MB per run | done |
| 3 | Receiver read routes (index, one result, one image), traversal-safe, local only | done |
| 4 | `TestResultsComponent` in `triangular-engine/testing`: run list with filters, run detail with baseline change, compare, thumbnails | done |
| 5 | Demo app: `/tests` route, catalog entry, planet-shape-lab thumbnail through `ScreenshotService` | done |
| 6 | Docs: testing guide, skill, changelog | done |

## Out of scope

- Thumbnails for motion labs (fly-bys): they need an extra untimed pass. Left without thumbnails.
- Budgets, targets, verdicts from a baseline. The metric cell only leaves room for a target bar.
- Any change to how timings are measured.

## Done when

The testing and receiver specs pass, the planet-shape-lab specs pass, the library and demo compile, and `/tests`
shows real saved runs with thumbnails and the change from baseline.
