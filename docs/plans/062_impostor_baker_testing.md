---
type: Plan
title: Impostor Baker Testing
description: Add reusable functional and diagnostic performance scenarios for the octahedral impostor baker demo page.
timestamp: 2026-10-25T00:00:00Z
tags: [impostor, testing, performance, demo]
runbook: /docs/runbook/062_impostor_baker_testing.md
performance: []
---

# Plan 062: Impostor Baker Testing

Status: **planned**. Evidence and decisions: [Runbook 062](/docs/runbook/062_impostor_baker_testing.md).

**Goal:** expose repeatable checks and diagnostic measurements on `/impostor-baker` using the public
`triangular-engine/testing` entry point, so the page can identify which bake and asset-preparation stages dominate
cost without presenting browser frame cadence as GPU timing.

## Scope

| # | Item | Status |
|---|---|---|
| 1 | Add `TestRunnerComponent` to the page and a separate, oldest-first scenario history and adapter module | planned |
| 2 | Add deterministic functional checks for atlas creation, impostor material/mesh, instance count, and restoration | planned |
| 3 | Instrument page-owned stages: source tree build, atlas bake, impostor/preview setup, forest instance generation, and compression | planned |
| 4 | Add bounded diagnostic scenarios for atlas size, sprite count, projection mode, forest count, and compression options | planned |
| 5 | Record the actual renderer/device and metric limitations; retain dev results using the existing test sink | planned |
| 6 | Add focused adapter specs and update the impostor documentation for verified behavior | planned |

## Measurement rules

- Keep functional checks and performance experiments in distinct suites and versions.
- Report synchronous page/API elapsed time as main-thread wall time. Atlas bake timing includes all view renders and renderer setup/restoration; it is not a GPU timestamp.
- Use actual GPU timestamp evidence only if the active renderer exposes a supported timing provider. Do not use FPS or frame cadence as a substitute.
- Leave diagnostic measurements unassessed until a controlled profile and budget or baseline exist. Use visible, focused runs on the target GPU for performance evidence; headless runs cover functional integration.
- Keep the initial matrix small enough for iteration. Use bounded representative values before adding the largest 4096 atlas or 10,000-instance case to routine runs.

## Acceptance

- The panel runs from the page, binds readiness to a completed usable bake, and prevents manual controls from mutating the scene during a run.
- Cancellation and failures restore the captured page settings and leave no adapter subscriptions or background work.
- Checks prove expected atlas dimensions and attachments, a usable impostor mesh/material, expected instance count, and successful restoration.
- Results contain stage-specific metrics with explicit units, sources, environment, and limitations. Missing GPU timing remains explicitly unavailable.
- The page has an exact-version launch link and saved results are discoverable through the existing test summary flow.
- Relevant page and adapter specs pass, and the triangular-engine library build passes.
