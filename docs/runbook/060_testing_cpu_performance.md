---
type: Runbook
title: Testing Entry for CPU Performance Work
description: Decisions and checks for CPU span timing, micro-bench cases and the Node-safe core of the testing entry.
timestamp: 2026-10-24T00:00:00Z
tags: [testing, cpu, performance, tooling]
plans: [/docs/plans/060_testing_cpu_performance.md]
performance: []
---

# Runbook 060: Testing Entry for CPU Performance Work

Plan: [Plan 060](/docs/plans/060_testing_cpu_performance.md).

## 2026-10-24 - Built

### Decisions

- **Core entry.** `testing/core` holds everything with no Angular, DOM or session dependency (timer, helpers, spans,
  CPU measurement). `testing` re-exports it, so `import { createSpanRecorder } from 'triangular-engine/testing'` and
  `.../testing/core` are the same code. Its metric type (`CpuMetric`) is structural, so core never imports the Angular entry.
- **CPU evidence.** `TestSuite.evidence: 'cpu'` (or `TestRunAdapter.cpuOnly`) skips the GPU vendor and headless-profile
  rules, the focus watch, the ready gate and thumbnails, and adds `CPU_ONLY_LIMITATION` to every case. The default stays `gpu`.
- **Baseline tolerance.** The 0.05 floor is for `ms` only (`defaultMinRegression(unit)`); other units use the relative
  bound unless the baseline gives `minRegression` or per-metric `tolerances`. Existing ms baselines judge exactly as before.
- **Span cost.** The recorder measures an empty begin/end pair at creation (smallest of five runs): the in-span part is
  removed from each span, the whole pair from the round total, so `unattributed` is not inflated by the timer.
- **Settle check.** A series is re-evaluated only after growing 10 %; in between the last answer stands.
- **Engines.** `environment.jsEngine` is recorded on every run; a baseline with a `jsEngine` of another family
  (`node`, `chrome`, `firefox`, `safari`) is skipped with a note.

### Checks

- `npm run test:triangular-engine:testing`: 169 specs pass. `npm run test:triangular-engine:sink`: 38 pass.
- `npm run build:triangular-engine`: builds `testing/core` and `testing`; the core bundle has no `ɵɵngDeclare*` and imports under Node 22.

### Open

- A Node runner that drives `cpuBench` scenarios without the Angular `TestSession` (the core functions work; the
  session, receiver posting and summary do not run there yet).
