---
type: Plan
title: Test Runner Batch Runs and a Deterministic Stop Rule
description: Run an ordered batch of tests as fast as the page allows, stop each steady measurement on data rather than a chosen duration, and copy every summary at once.
timestamp: 2026-10-24T00:00:00Z
tags: [testing, performance, tooling, runner]
runbook: /docs/runbook/061_test_runner_batch_and_stop_rule.md
performance: []
---

# Plan 061: Test Runner Batch Runs and a Deterministic Stop Rule

2026-10-25 correction: **Run all** must preserve a suite-level A/B experiment as one session; splitting rounds
into independent results removes the opposite arm and makes every comparison invalid. Independent suites keep
incremental scenario saves. The main **Run suite** action also clears stale batch summaries. This correction
does not change the stop rule or combine arbitrary manually assembled batches. Verification is recorded in
[runbook 061](/docs/runbook/061_test_runner_batch_and_stop_rule.md).

Status: **proposal, not started.** Every number below is a proposal for owner approval, not a decision. Current contracts are in the [testing guide](../../projects/triangular-engine/testing/README.md). Related work: [052 page test sessions](/docs/plans/052_page_test_sessions_and_performance_comparison.md) and [060 CPU performance](/docs/plans/060_testing_cpu_performance.md). Evidence and open decisions are logged in [runbook 061](/docs/runbook/061_test_runner_batch_and_stop_rule.md).

## 1. Summary

Today a window runs for a time somebody picked, and one failed check ends the whole run. This plan runs an ordered list of tests as a batch, as fast as the page allows. Each test keeps sampling real completed frames until a stated quality target is met, then records why it stopped. A hard cap only guards against hangs, and a capped test is inconclusive, never a pass. When the batch ends, every test's summary is copied to the clipboard, with a Copy button as fallback.

## 2. Goals and non-goals

Goals:
- One batch of tests, run in sequence, one copy-all result.
- Stop on data, not on durations an agent guessed.
- One library-wide tolerance, documented once.
- A test declares what "settled" means; the runner waits for it.
- A failed test does not stop the batch.

Non-goals:
- No batch-wide time budget. Only a per-test limit.
- No pacing option. The `human-observed` profile already covers watching.
- No change to budgets, baselines, ablation or machine context.
- No new renderer or router dependency.

## 3. Test model (phases)

A test is a sequence of phases, not one of a fixed set of kinds.

1. Prelude (optional, unmeasured): a scripted action, or a settle wait. Today `ready()` and a fixed `warmupMs` do this (`test-session.ts:245`, `:258`).
2. Measured window, one of:
   - steady: sample until the stop rule fires.
   - scripted: a camera path or sweep, with length in frames or simulation time, never wall-clock.
   - counted: a fixed iteration count (collider blocks, CPU benches).

Why: a survey of one consumer app's scenarios found 259 of 274 steady, 15 scripted, 0 mixed. 57 steady scenarios have no early-stop window today, because they pass no settle series (`test-window.ts:95-98` falls back to a fixed length). Counted tests exist, yet the session budget treats them as time (`modeWindowMs`, `test-session.ts:123`).

Scripted tests still report frame-time metrics. A lagging scripted run then fails a check that has data behind it, instead of passing silently.

A settle condition is declared by the test, for example "queued work is 0 and the camera has stopped". The runner polls it and requires two passing checks in a row, so one lucky poll cannot end the wait.

## 4. Stop rule and quality target

Current rule, for reference: split the window into two halves; settled when the medians agree within 5% and the p95s within 10%, or within the timer step (`test-window.ts:15-17`, `:22-38`). Floors: 60 samples and 1 s (`test-window.ts:6-8`).

Proposed rule:

| Part | Proposal | Reason |
|---|---|---|
| Warm-up | discard a fixed warm-up first. Proposed 60 frames or 500 ms, whichever is later | shader compiles, GC and uploads distort early frames. Today quick mode only caps warm-up at 0.5 s (`test-window.ts:12`, `:23-26`) |
| Blocks | split samples into at least 4 blocks and compare block medians and p95s (batch means) | consecutive frames are correlated, so two halves look steadier than they are |
| Tolerance | keep the current relative rule with a floor at the timer step: `max(abs(value) * tol, resolution)`, applied to median and p95 | it is already tested (`test-window.ts:21-23`). One library value, not per test |
| Tolerance values | start from the current 5% (median) and 10% (p95) | continuity with existing quick runs |
| Settled | two checks in a row pass | one pass can be luck |
| Hitches | report the count of frames over 2x median as a metric | informs a reader. Not a stop condition |

Stop reasons, recorded on the case (extends `TestWindow.stoppedBy`, `test-contracts.ts:226`, which is `settled | max | fixed` today):
- `settled`: the target was met. Valid evidence.
- `capped`: the hard cap hit first. The case is inconclusive, never a pass. This is what `max` means today, but it currently counts as a normal result.
- `failed`: a check failed or the test threw.
- `fixed`: scripted and counted windows, which end by their own length.

The hard cap is a safety net. Proposal: a per-test limit that is generous (for example 60 s), never tuned per test to make results look settled.

## 5. Batch runner and copy-all

- Input: an ordered array of tests (suite plus scenario ids). Run in order, one at a time.
- Time limit: per test only. Today the timeout is one budget for the whole run (`test-session.ts:19-20`, `:122`), grown by summed durations. That sum goes away.
- A failed test records its result and the batch continues. Today a failed check throws and ends the run (`test-session.ts:291`, `:304`, `:313-315`).
- Each test restores state before the next starts. The restore logic exists once per run today (`test-session.ts:319-327`); it moves to per test.
- Each result is saved to the sink as soon as it finishes, so a crash keeps earlier results. Today saving happens once at the end (`test-runner.component.ts:228-237`).
- Copy-all: when the batch finishes, copy every test's summary, separated by a blank line. Each summary starts with its stop reason (settled, capped, failed). Today only one run's hand-off text is copied (`testRunAgentText`, `test-runner.component.ts:83-96`, `:292-300`). The new text reuses its lines, per test.
- Fallback: a Copy button, because Chrome only allows clipboard writes in a focused tab (`test-runner.component.ts:294-295` already reports "Not copied").

## 6. Between-test hygiene and drift check

- After each test, wait for the GPU to finish queued work, then a short cooldown. Proposal: 250 ms. Reason: the next test should not inherit the last one's queue or heat.
- Run one reference test at the start and at the end of the batch, and flag drift between them. Proposal: flag when the reference median moves by more than the tolerance. Reason: it shows thermal throttling or background load that no single test can see. Soak already reports drift inside one window (`test-window.ts:40-48`), and this extends the idea across the batch.
- The existing machine context (power, GPU busy) still runs per timed case (`test-session.ts:165-167`, `:261`).

## 7. Migration

Library (`triangular-engine/testing`):
- `test-contracts.ts`: add phases to `TestScenario` (`:7-31`); add `capped` and a per-test stop reason to `TestWindow` (`:223-232`); add a batch type beside `TestRunOptions` (`:330`).
- `test-window.ts`: replace the two-half check (`seriesSettled`, `:29-38`) with the block check; keep `agrees` (`:22`).
- `test-session.ts`: per-test timeout and restore, continue after failure, replace the summed budget (`:122-123`).
- `test-runner.component.ts`: batch selection, per-test save, copy-all plus button.
- `test-launch.ts`: a launch link for a batch (today one suite and version, `:63-92`).
- Keep old scenarios working: `durationMs` stays as the cap, and series-less scenarios gain a settle condition only when authored.

Consumer apps:
- The first consumer app writes phases and settle conditions for its adapter first, and gives its 57 steady scenarios a series.
- A second consumer app adopts the same contract when it moves to the new engine version. See the open questions in [runbook 061](/docs/runbook/061_test_runner_batch_and_stop_rule.md).

## 8. Verification plan

Nothing is run yet. What would prove it:
- Unit tests for the block rule on synthetic series: steady (settles), a ramp (does not), a spike train (hitch count high, still settles), correlated noise (two halves would pass, blocks do not).
- A session test with three fake tests, the middle one failing: all three results exist, the batch continues, and restore ran three times.
- A cap test: a series that never settles ends `capped` and the verdict is inconclusive.
- Clipboard test: the copied text has one block per test, blank-line separated, each starting with its stop reason.
- Compare old quick runs and new runs on a few demo scenarios: the new median is within tolerance, and total time is not longer.
- Drift check: inject a slow-down between reference runs and confirm the flag.
- A visible-tab run on real hardware for the reference test, since headless timings are not hardware numbers ([testing guide](../../projects/triangular-engine/testing/README.md), "Evidence and limitations").
