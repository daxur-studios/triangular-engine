---
type: Plan
title: Testing Entry for CPU Performance Work
description: Named span timing, CPU micro-bench cases, shared helpers, runner fixes and a Node-safe core entry for triangular-engine/testing.
timestamp: 2026-10-24T00:00:00Z
tags: [testing, cpu, performance, tooling]
runbook: /docs/runbook/060_testing_cpu_performance.md
performance: []
---

# Plan 060: Testing Entry for CPU Performance Work

Status: **built, specs and library build green; not released.** Evidence: [Runbook 060](/docs/runbook/060_testing_cpu_performance.md).

**Goal:** let a consumer measure which sub-parts of a per-tick CPU computation cost most, at several problem sizes,
without a scene, a ready gate, thumbnails or vsync pacing, and without that evidence being mistaken for GPU evidence.

## Scope

| # | Item | Status |
|---|---|---|
| 1 | `createSpanRecorder` and `TestMetric.group`/`share`; results page and `triangular-test-summary` print a breakdown table | done |
| 2 | `cpuBench`, `measureCpuCase`, IQR outliers, scaling exponent; `TestSuite.evidence: 'cpu'`, `TestRunAdapter.cpuOnly` | done |
| 3 | Shared helpers: `metric`, `timeMetric`, `waitFor`, `onFrames`, `waitRenderedFrames`, `timedWindow`, `scenarioFactory`, `simpleAdapter`, `describeTimer` | done |
| 4 | Runner: incremental settle check, `warmupIterations`, per-metric baseline `tolerances` | done |
| 5 | `triangular-engine/testing/core` (no Angular, runs in Node); engine tag, cross-engine baselines refused | done (cases run in Node through the core functions; the session itself still needs the Angular entry) |
